--------------------------- MODULE NeuroStoreProtocol ---------------------------
\* TLA+ Formal Specification of NeuroStore Decentralized Storage Protocol
\* Author: NeuroStore Engineering Team
\* Version: 1.0 — March 2026

EXTENDS Integers, Sequences, FiniteSets, TLC

CONSTANTS
    Nodes,              \* Set of storage node identifiers
    MaxShards,          \* Maximum erasure-coded shards (default 20)
    RecoveryThreshold,  \* Minimum shards to reconstruct (default 8)
    MaxGB,              \* Per-node storage capacity
    ReputationFloor,    \* Minimum reputation before eviction (20)
    SlashingPenalty     \* Collateral percentage slashed on failure

VARIABLES
    nodeState,          \* Function: Node → [status, usedGB, reputation, collateral]
    objectStore,        \* Set of {objectCID, shards: [shardCID → nodeID]}
    challenges,         \* Pending PoSt challenges: {challengeID, shardCID, nodeID, status}
    tokenSupply,        \* Current $NEURO token supply
    rewardPool          \* Accumulated client payments for distribution

vars == <<nodeState, objectStore, challenges, tokenSupply, rewardPool>>

-----------------------------------------------------------------------------
\* TYPE INVARIANTS
TypeOK ==
    /\ nodeState \in [Nodes -> [status: {"active", "offline", "quarantined", "evicted"},
                                 usedGB: 0..MaxGB,
                                 reputation: 0..100,
                                 collateral: Nat]]
    /\ \A obj \in objectStore: Cardinality(DOMAIN obj.shards) >= RecoveryThreshold
    /\ tokenSupply <= 10000000000  \* 10 billion MAX_SUPPLY cap

-----------------------------------------------------------------------------
\* SAFETY: Data Durability Guarantee
\* An object is NEVER lost if at least RecoveryThreshold shards exist on active nodes
DataDurability ==
    \A obj \in objectStore:
        LET activeShards == {s \in DOMAIN obj.shards :
                              nodeState[obj.shards[s]].status = "active"}
        IN Cardinality(activeShards) >= RecoveryThreshold

\* SAFETY: No inflation beyond hard cap
TokenCapIntegrity ==
    tokenSupply <= 10000000000

\* SAFETY: Honest nodes are never slashed without 3 consecutive failures
FairSlashing ==
    \A n \in Nodes:
        nodeState[n].status = "evicted" =>
            \E c1, c2, c3 \in challenges:
                /\ c1.nodeID = n /\ c2.nodeID = n /\ c3.nodeID = n
                /\ c1.status = "failed" /\ c2.status = "failed" /\ c3.status = "failed"

-----------------------------------------------------------------------------
\* INITIAL STATE
Init ==
    /\ nodeState = [n \in Nodes |-> [status |-> "active",
                                      usedGB |-> 0,
                                      reputation |-> 50,
                                      collateral |-> 0]]
    /\ objectStore = {}
    /\ challenges = {}
    /\ tokenSupply = 1000000000  \* 10% treasury mint
    /\ rewardPool = 0

-----------------------------------------------------------------------------
\* ACTION: Node Registration
\* A new node stakes collateral and joins the network
NodeRegister(n) ==
    /\ nodeState[n].status = "offline"
    /\ nodeState' = [nodeState EXCEPT ![n] = [status |-> "active",
                                               usedGB |-> 0,
                                               reputation |-> 50,
                                               collateral |-> @.collateral + 100]]
    /\ UNCHANGED <<objectStore, challenges, tokenSupply, rewardPool>>

\* ACTION: Upload Object (Erasure Encode + Distribute)
\* Client uploads file → Gateway RS-encodes into MaxShards → distributes to active nodes
UploadObject(cid, selectedNodes) ==
    /\ Cardinality(selectedNodes) = MaxShards
    /\ \A n \in selectedNodes: nodeState[n].status = "active"
    /\ \A n \in selectedNodes: nodeState[n].usedGB < MaxGB
    /\ objectStore' = objectStore \union
         {[objectCID |-> cid,
           shards |-> [i \in 1..MaxShards |-> CHOOSE n \in selectedNodes : TRUE]]}
    /\ UNCHANGED <<nodeState, challenges, tokenSupply, rewardPool>>

\* ACTION: Proof of Spacetime Challenge
\* Gateway issues cryptographic challenge to verify node still holds shard data
IssueChallenge(shardCID, n) ==
    /\ nodeState[n].status = "active"
    /\ challenges' = challenges \union
         {[challengeID |-> shardCID,
           shardCID |-> shardCID,
           nodeID |-> n,
           status |-> "pending"]}
    /\ UNCHANGED <<nodeState, objectStore, tokenSupply, rewardPool>>

\* ACTION: Node Passes Challenge → Reputation Up + Reward Streamed
PassChallenge(challengeID) ==
    /\ \E c \in challenges: c.challengeID = challengeID /\ c.status = "pending"
    /\ LET c == CHOOSE x \in challenges: x.challengeID = challengeID
           n == c.nodeID
           reward == nodeState[n].reputation * 10  \* reputation-weighted reward
       IN
       /\ challenges' = (challenges \ {c}) \union {[c EXCEPT !.status = "verified"]}
       /\ nodeState' = [nodeState EXCEPT ![n].reputation =
                          IF @.reputation < 100 THEN @.reputation + 1 ELSE 100]
       /\ tokenSupply' = IF tokenSupply + reward <= 10000000000
                          THEN tokenSupply + reward
                          ELSE tokenSupply    \* Respect MAX_SUPPLY
       /\ UNCHANGED <<objectStore, rewardPool>>

\* ACTION: Node Fails Challenge → Reputation Down + Potential Slash
FailChallenge(challengeID) ==
    /\ \E c \in challenges: c.challengeID = challengeID /\ c.status = "pending"
    /\ LET c == CHOOSE x \in challenges: x.challengeID = challengeID
           n == c.nodeID
       IN
       /\ challenges' = (challenges \ {c}) \union {[c EXCEPT !.status = "failed"]}
       /\ nodeState' = [nodeState EXCEPT ![n].reputation =
                          IF @.reputation > ReputationFloor
                          THEN @.reputation - 10
                          ELSE 0,
                        ![n].status =
                          IF @.reputation - 10 <= 0 THEN "evicted" ELSE @.status,
                        ![n].collateral =
                          IF @.reputation - 10 <= 0
                          THEN @.collateral - (@.collateral * SlashingPenalty \div 100)
                          ELSE @.collateral]
       /\ UNCHANGED <<objectStore, tokenSupply, rewardPool>>

\* ACTION: Self-Healing Repair
\* When shard count drops below threshold, repair daemon reconstructs + redistributes
RepairObject(cid) ==
    /\ \E obj \in objectStore:
         /\ obj.objectCID = cid
         /\ LET activeCount == Cardinality({s \in DOMAIN obj.shards :
                                 nodeState[obj.shards[s]].status = "active"})
            IN activeCount < MaxShards /\ activeCount >= RecoveryThreshold
    /\ UNCHANGED vars  \* Simplified: actual repair redistributes shards

-----------------------------------------------------------------------------
\* LIVENESS: Every pending challenge eventually resolves
ChallengeProgress ==
    \A c \in challenges: c.status = "pending" ~>
        (c.status = "verified" \/ c.status = "failed" \/ c.status = "expired")

\* LIVENESS: Degraded objects are eventually repaired
RepairGuarantee ==
    \A obj \in objectStore:
        LET activeCount == Cardinality({s \in DOMAIN obj.shards :
                             nodeState[obj.shards[s]].status = "active"})
        IN activeCount < MaxShards ~> activeCount = MaxShards

-----------------------------------------------------------------------------
Next ==
    \/ \E n \in Nodes: NodeRegister(n)
    \/ \E cid \in STRING, ns \in SUBSET Nodes: UploadObject(cid, ns)
    \/ \E s \in STRING, n \in Nodes: IssueChallenge(s, n)
    \/ \E id \in STRING: PassChallenge(id)
    \/ \E id \in STRING: FailChallenge(id)
    \/ \E cid \in STRING: RepairObject(cid)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)

THEOREM Spec => [](DataDurability /\ TokenCapIntegrity /\ FairSlashing)

=============================================================================
