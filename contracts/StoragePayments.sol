// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NeuroStore Storage Payments
 * @dev Handles trustless $NEURO token micropayments based on AI Sentinel PoSt validations.
 */
contract StoragePayments {
    address public admin;
    
    // Mapping of active storage nodes to their earned $NEURO balances
    mapping(address => uint256) public nodeBalances;
    
    // Total pooled $NEURO awaiting distribution
    uint256 public rewardPool;

    event PaymentDispatched(address indexed node, uint256 amount, string reason);
    event FundsDeposited(address indexed client, uint256 amount);
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
     * @dev Called by the AI Sentinel when a node proves storage and earns reputation.
     */
    function dispatchPayout(address node, uint256 amount, string calldata reason) external onlyAdmin {
        require(rewardPool >= amount, "Insufficient reward pool.");
        rewardPool -= amount;
        nodeBalances[node] += amount;
        
        emit PaymentDispatched(node, amount, reason);
    }
    
    /**
     * @dev Called by the AI Sentinel when a node drops shards or fails PoSt.
     */
    function slashNode(address node, uint256 penalty, string calldata reason) external onlyAdmin {
        if (nodeBalances[node] >= penalty) {
            nodeBalances[node] -= penalty;
            rewardPool += penalty;
        } else {
            rewardPool += nodeBalances[node];
            nodeBalances[node] = 0;
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
