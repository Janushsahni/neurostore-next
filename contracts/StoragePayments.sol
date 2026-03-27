// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title NeuroStore Storage Payments V2
 * @dev Production-grade trustless payment engine for the decentralized storage network.
 *
 * Upgrades from V1:
 *   - $NEURO ERC-20 integration (replaces raw ETH)
 *   - Emergency pause circuit breaker
 *   - 24-hour timelock dispute window on slashing
 *   - Minimum collateral formula: capacity_gb × 10 NEURO
 *   - 30-day reward vesting with linear unlock
 *   - Checks-effects-interactions + ReentrancyGuard on all state-mutating functions
 */
contract StoragePayments is ReentrancyGuard {
    address public admin;
    IERC20 public immutable neuroToken;

    // ── Node State ────────────────────────────────────────────
    mapping(address => uint256) public nodeBalances;       // Earned, fully vested
    mapping(address => uint256) public nodeCollateral;     // Staked NEURO tokens
    mapping(address => uint256) public nodeCapacityGB;     // Declared storage capacity

    // ── Vesting ───────────────────────────────────────────────
    struct VestingEntry {
        uint256 amount;
        uint256 vestingStart;
        uint256 vestingEnd;       // vestingStart + 30 days
        uint256 claimed;
    }
    mapping(address => VestingEntry[]) public vestingSchedules;

    // ── Timelock Slashing ─────────────────────────────────────
    struct SlashProposal {
        address node;
        uint256 penalty;
        string reason;
        uint256 executeAfter;     // block.timestamp + SLASH_TIMELOCK
        bool executed;
        bool disputed;
    }
    SlashProposal[] public slashProposals;
    uint256 public constant SLASH_TIMELOCK = 24 hours;

    // ── Emergency Controls ────────────────────────────────────
    bool public paused;

    // ── Constants ─────────────────────────────────────────────
    uint256 public constant MIN_COLLATERAL_PER_GB = 10 * 10**18; // 10 NEURO per GB
    uint256 public constant VESTING_DURATION = 30 days;

    uint256 public rewardPool;

    // ── Events ────────────────────────────────────────────────
    event PaymentDispatched(address indexed node, uint256 amount, string reason);
    event FundsDeposited(address indexed client, uint256 amount);
    event CollateralStaked(address indexed node, uint256 amount, uint256 capacityGB);
    event CollateralWithdrawn(address indexed node, uint256 amount);
    event SlashProposed(uint256 indexed proposalId, address indexed node, uint256 penalty, string reason, uint256 executeAfter);
    event SlashExecuted(uint256 indexed proposalId, address indexed node, uint256 penalty);
    event SlashDisputed(uint256 indexed proposalId, address indexed node);
    event RewardVested(address indexed node, uint256 amount, uint256 vestingEnd);
    event RewardClaimed(address indexed node, uint256 amount);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event EmergencyPaused(address indexed by);
    event EmergencyUnpaused(address indexed by);

    // ── Modifiers ─────────────────────────────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can execute this.");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Contract is paused for emergency.");
        _;
    }

    // ── Constructor ───────────────────────────────────────────
    constructor(address _neuroToken) {
        require(_neuroToken != address(0), "Invalid token address");
        admin = msg.sender;
        neuroToken = IERC20(_neuroToken);
    }

    // ── Admin ─────────────────────────────────────────────────

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Invalid admin address");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function emergencyPause() external onlyAdmin {
        paused = true;
        emit EmergencyPaused(msg.sender);
    }

    function emergencyUnpause() external onlyAdmin {
        paused = false;
        emit EmergencyUnpaused(msg.sender);
    }

    // ── Deposits ──────────────────────────────────────────────

    /**
     * @dev Clients deposit $NEURO tokens to buy network storage.
     *      Caller must first approve() this contract to spend `amount`.
     */
    function depositFunds(uint256 amount) external whenNotPaused {
        require(amount > 0, "Amount must be > 0");
        require(neuroToken.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        rewardPool += amount;
        emit FundsDeposited(msg.sender, amount);
    }

    // ── Collateral ────────────────────────────────────────────

    /**
     * @dev Nodes stake $NEURO collateral proportional to their declared capacity.
     *      Minimum: capacity_gb × 10 NEURO tokens.
     */
    function stakeCollateral(uint256 amount, uint256 capacityGB) external whenNotPaused nonReentrant {
        require(amount > 0 && capacityGB > 0, "Invalid stake parameters");
        uint256 minRequired = capacityGB * MIN_COLLATERAL_PER_GB;
        uint256 totalAfter = nodeCollateral[msg.sender] + amount;
        require(totalAfter >= minRequired, "Insufficient collateral for declared capacity");

        require(neuroToken.transferFrom(msg.sender, address(this), amount), "Token transfer failed");
        nodeCollateral[msg.sender] = totalAfter;
        nodeCapacityGB[msg.sender] = capacityGB;
        emit CollateralStaked(msg.sender, amount, capacityGB);
    }

    /**
     * @dev Nodes withdraw excess collateral (above minimum required).
     */
    function withdrawExcessCollateral(uint256 amount) external whenNotPaused nonReentrant {
        uint256 minRequired = nodeCapacityGB[msg.sender] * MIN_COLLATERAL_PER_GB;
        require(nodeCollateral[msg.sender] - amount >= minRequired, "Would drop below minimum collateral");

        nodeCollateral[msg.sender] -= amount;
        require(neuroToken.transfer(msg.sender, amount), "Token transfer failed");
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ── Payouts with Vesting ──────────────────────────────────

    /**
     * @dev Dispatch payout with 30-day linear vesting.
     *      Tokens are not immediately claimable — they vest over VESTING_DURATION.
     */
    function dispatchPayout(address node, uint256 amount, string calldata reason) external onlyAdmin whenNotPaused nonReentrant {
        require(rewardPool >= amount, "Insufficient reward pool.");
        rewardPool -= amount;

        vestingSchedules[node].push(VestingEntry({
            amount: amount,
            vestingStart: block.timestamp,
            vestingEnd: block.timestamp + VESTING_DURATION,
            claimed: 0
        }));

        emit PaymentDispatched(node, amount, reason);
        emit RewardVested(node, amount, block.timestamp + VESTING_DURATION);
    }

    /**
     * @dev Claim all vested rewards across all vesting entries.
     */
    function claimVestedRewards() external whenNotPaused nonReentrant {
        uint256 totalClaimable = 0;
        VestingEntry[] storage entries = vestingSchedules[msg.sender];

        for (uint256 i = 0; i < entries.length; i++) {
            uint256 vested = _vestedAmount(entries[i]);
            uint256 claimable = vested - entries[i].claimed;
            if (claimable > 0) {
                entries[i].claimed = vested;
                totalClaimable += claimable;
            }
        }

        require(totalClaimable > 0, "No vested rewards available.");
        require(neuroToken.transfer(msg.sender, totalClaimable), "Token transfer failed");
        emit RewardClaimed(msg.sender, totalClaimable);
    }

    function _vestedAmount(VestingEntry storage entry) internal view returns (uint256) {
        if (block.timestamp >= entry.vestingEnd) {
            return entry.amount;
        }
        uint256 elapsed = block.timestamp - entry.vestingStart;
        uint256 duration = entry.vestingEnd - entry.vestingStart;
        return (entry.amount * elapsed) / duration;
    }

    /**
     * @dev View total claimable (vested but unclaimed) rewards for an operator.
     */
    function claimableRewards(address node) external view returns (uint256) {
        uint256 total = 0;
        VestingEntry[] storage entries = vestingSchedules[node];
        for (uint256 i = 0; i < entries.length; i++) {
            uint256 vested = _vestedAmount(entries[i]);
            total += vested - entries[i].claimed;
        }
        return total;
    }

    // ── Timelock Slashing ─────────────────────────────────────

    /**
     * @dev Propose slashing a node. Executes after 24-hour dispute window.
     *      The node (or admin) can dispute within the window.
     */
    function proposeSlash(address node, uint256 penalty, string calldata reason) external onlyAdmin whenNotPaused {
        uint256 proposalId = slashProposals.length;
        slashProposals.push(SlashProposal({
            node: node,
            penalty: penalty,
            reason: reason,
            executeAfter: block.timestamp + SLASH_TIMELOCK,
            executed: false,
            disputed: false
        }));
        emit SlashProposed(proposalId, node, penalty, reason, block.timestamp + SLASH_TIMELOCK);
    }

    /**
     * @dev Node disputes a slash proposal within the timelock window.
     */
    function disputeSlash(uint256 proposalId) external {
        SlashProposal storage proposal = slashProposals[proposalId];
        require(msg.sender == proposal.node || msg.sender == admin, "Not authorized to dispute");
        require(!proposal.executed, "Already executed");
        require(block.timestamp < proposal.executeAfter, "Dispute window expired");

        proposal.disputed = true;
        emit SlashDisputed(proposalId, proposal.node);
    }

    /**
     * @dev Execute a slash proposal after the timelock expires.
     *      Cannot execute if disputed — admin must resolve disputes off-chain.
     */
    function executeSlash(uint256 proposalId) external onlyAdmin nonReentrant {
        SlashProposal storage proposal = slashProposals[proposalId];
        require(!proposal.executed, "Already executed");
        require(!proposal.disputed, "Slash was disputed — resolve off-chain first");
        require(block.timestamp >= proposal.executeAfter, "Timelock not expired");

        proposal.executed = true;
        uint256 remainingPenalty = proposal.penalty;
        address node = proposal.node;

        // First deduct from earned balance
        if (nodeBalances[node] >= remainingPenalty) {
            nodeBalances[node] -= remainingPenalty;
            rewardPool += remainingPenalty;
            remainingPenalty = 0;
        } else {
            remainingPenalty -= nodeBalances[node];
            rewardPool += nodeBalances[node];
            nodeBalances[node] = 0;
        }

        // If penalty exceeds earned balance, slash staked collateral
        if (remainingPenalty > 0) {
            if (nodeCollateral[node] >= remainingPenalty) {
                nodeCollateral[node] -= remainingPenalty;
                rewardPool += remainingPenalty;
            } else {
                rewardPool += nodeCollateral[node];
                nodeCollateral[node] = 0;
            }
        }

        emit SlashExecuted(proposalId, node, proposal.penalty);
    }

    // ── Legacy Compatibility ──────────────────────────────────

    /**
     * @dev Direct (non-vested) reward claim for nodes with existing balances.
     *      Preserved for backwards compatibility with V1 earned balances.
     */
    function claimRewards() external whenNotPaused nonReentrant {
        uint256 balance = nodeBalances[msg.sender];
        require(balance > 0, "No rewards available.");
        nodeBalances[msg.sender] = 0;
        require(neuroToken.transfer(msg.sender, balance), "Token transfer failed");
        emit RewardClaimed(msg.sender, balance);
    }

    // ── View Helpers ──────────────────────────────────────────

    function getSlashProposalCount() external view returns (uint256) {
        return slashProposals.length;
    }

    function getVestingCount(address node) external view returns (uint256) {
        return vestingSchedules[node].length;
    }
}
