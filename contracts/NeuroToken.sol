// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NeuroStore Token ($NEURO)
 * @dev The economic settlement engine for the decentralized storage network.
 *      Deployed to Base L2. Allows the Gateway to stream ERC-20 utility tokens
 *      to Node Operators based on verified Proof of Spacetime (PoSt) calculations.
 *
 * Security hardening:
 *   - MAX_SUPPLY cap prevents unlimited inflation
 *   - streamRewards() restricted to onlyOwner (gateway)
 *   - Epoch-based cooldown prevents reward-draining attacks
 */
contract NeuroToken is ERC20, Ownable {
    uint256 public constant SECONDS_PER_EPOCH = 12; // 1 Base L2 Block
    uint256 public constant REWARD_PER_EPOCH_PER_GB = 10 * 10**18; // 10 NEURO per GB/epoch

    // Hard cap: 10 billion NEURO tokens maximum supply
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10**18;

    // Minimum seconds between reward claims per operator (prevents drain attacks)
    uint256 public constant MIN_CLAIM_INTERVAL = 60;

    // Tracks total verified storage per physical operator
    mapping(address => uint256) public storageAllocationsGB;
    
    // Tracks the last claimed epoch timestamp for precision streaming
    mapping(address => uint256) public lastClaimedTimestamp;

    event StorageVerified(address indexed operator, uint256 gigabytes);
    event RewardsStreamed(address indexed operator, uint256 amount);

    /**
     * @notice Initialize the NeuroStore settlement token
     */
    constructor() ERC20("NeuroStore", "NEURO") Ownable(msg.sender) {
        // Mint initial supply to Treasury (10% of MAX_SUPPLY) for liquidity pools
        _mint(msg.sender, 1_000_000_000 * 10**decimals());
    }

    /**
     * @notice Gateway verifies a Proof of Spacetime.
     *         Updates the operator's active storage allocation in gigabytes.
     * 
     * @param operator The wallet address of the node operator.
     * @param gigabytesStored The verified physical payload size.
     */
    function verifyStoragePoSt(address operator, uint256 gigabytesStored) external onlyOwner {
        storageAllocationsGB[operator] = gigabytesStored;
        if (lastClaimedTimestamp[operator] == 0) {
            lastClaimedTimestamp[operator] = block.timestamp;
        }
        emit StorageVerified(operator, gigabytesStored);
    }

    /**
     * @notice Streams earned $NEURO tokens to the operator based on verified storage.
     *         Access restricted to owner (gateway) to prevent unauthorized reward draining.
     *         Enforces a minimum interval between claims and respects the MAX_SUPPLY cap.
     *
     * @param operator The wallet address of the node withdrawing rewards.
     */
    function streamRewards(address operator) external onlyOwner {
        uint256 lastClaimed = lastClaimedTimestamp[operator];
        require(lastClaimed > 0, "No verified PoSt on record.");
        require(block.timestamp > lastClaimed, "Rewards already streamed for current block.");

        uint256 timeDelta = block.timestamp - lastClaimed;
        require(timeDelta >= MIN_CLAIM_INTERVAL, "Minimum claim interval not met.");

        uint256 activeGB = storageAllocationsGB[operator];
        require(activeGB > 0, "No active storage allocation.");

        // Calculate reward: (time * GB * rate) / epoch_duration
        uint256 rewardAmount = (timeDelta * activeGB * REWARD_PER_EPOCH_PER_GB) / SECONDS_PER_EPOCH;
        require(rewardAmount > 0, "Insufficient epoch runtime for streaming.");

        // Enforce hard supply cap — cap reward if it would exceed MAX_SUPPLY
        uint256 currentSupply = totalSupply();
        if (currentSupply + rewardAmount > MAX_SUPPLY) {
            rewardAmount = MAX_SUPPLY - currentSupply;
            require(rewardAmount > 0, "MAX_SUPPLY reached. No more tokens can be minted.");
        }

        lastClaimedTimestamp[operator] = block.timestamp;

        // Mint the earned tokens to the operator's wallet
        _mint(operator, rewardAmount);

        emit RewardsStreamed(operator, rewardAmount);
    }
}
