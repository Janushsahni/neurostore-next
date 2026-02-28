// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NeuroStore Storage Payments
 * @dev Handles trustless $NEURO token micropayments based on AI Sentinel PoSt validations and RL-guided redundancy.
 */
contract StoragePayments {
    address public admin;
    
    // Mapping of active storage nodes to their earned $NEURO balances
    mapping(address => uint256) public nodeBalances;
    
    // Nodes must stake collateral to participate in the network
    mapping(address => uint256) public nodeCollateral;

    // Total pooled $NEURO awaiting distribution
    uint256 public rewardPool;

    event PaymentDispatched(address indexed node, uint256 amount, string reason);
    event FundsDeposited(address indexed client, uint256 amount);
    event CollateralStaked(address indexed node, uint256 amount);
    event NodeSlashed(address indexed node, uint256 amount, string reason);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only Sentinel API can execute this.");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * @dev Clients deposit funds to buy network storage.
     */
    function depositFunds() external payable {
        rewardPool += msg.value;
        emit FundsDeposited(msg.sender, msg.value);
    }

    /**
     * @dev Nodes stake collateral to ensure honest participation.
     */
    function stakeCollateral() external payable {
        require(msg.value > 0, "Must stake more than 0");
        nodeCollateral[msg.sender] += msg.value;
        emit CollateralStaked(msg.sender, msg.value);
    }

    /**
     * @dev Dynamic Payout: Called by the AI Sentinel based on dynamic price_per_gb and RL redundancy multipliers.
     */
    function dispatchPayout(address node, uint256 amount, string calldata reason) external onlyAdmin {
        require(rewardPool >= amount, "Insufficient reward pool.");
        rewardPool -= amount;
        nodeBalances[node] += amount;
        
        emit PaymentDispatched(node, amount, reason);
    }
    
    /**
     * @dev Slashing Mechanism: Called if AI Sentinel detects 3 consecutive critical anomalies or dropped chunks.
     * Slashes both earned balances AND staked collateral.
     */
    function slashNode(address node, uint256 penalty, string calldata reason) external onlyAdmin {
        uint256 remainingPenalty = penalty;

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
                // Slashed collateral gets burned or sent to a treasury (here we add it to the reward pool)
                rewardPool += remainingPenalty; 
            } else {
                rewardPool += nodeCollateral[node];
                nodeCollateral[node] = 0;
            }
        }
        
        emit NodeSlashed(node, penalty, reason);
    }

    /**
     * @dev Physical node operators claim their hard-earned $NEURO token rewards.
     */
    function claimRewards() external {
        uint256 balance = nodeBalances[msg.sender];
        require(balance > 0, "No rewards available.");
        
        nodeBalances[msg.sender] = 0;
        (bool success, ) = msg.sender.call{value: balance}("");
        require(success, "Transfer failed.");
    }
}
