import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Shield, Cpu, Database, Blocks } from 'lucide-react';

export const FAQ = () => {
    const [openIndex, setOpenIndex] = useState(0);

    const faqs = [
        {
            question: "How is NeuroStore better than Filecoin?",
            answer: "Filecoin requires massive computational overhead for Proof-of-Replication (PoRep) and Proof-of-Spacetime (PoSt). This means only massive data centers with 128GB+ RAM servers can afford to be Filecoin nodes. NeuroStore removes this bottleneck by using a lightweight AI Sentinel to verify uptime (pings) combined with Reed-Solomon Erasure Coding. This allows literally anyone with an idle laptop hard drive to become a node, massively decentralizing the network and driving the price per GB down by 90% compared to Filecoin.",
            icon: <Cpu className="text-primary mb-4" size={32} />
        },
        {
            question: "How does the Blockchain Ledger ensure data safety?",
            answer: "When a file is uploaded, our network generates a cryptographic Content ID (CID) representing the file's hash. The locations of the shards (which nodes hold which pieces) are committed to a fast Blockchain Ledger. This ensures the mapping between your account and your file's location is immutable, censorship-resistant, and cannot be tampered with by any central authority or rogue database admin.",
            icon: <Blocks className="text-blue-400 mb-4" size={32} />
        },
        {
            question: "If a node goes offline permanently, do I lose my file?",
            answer: "No. We use Reed-Solomon Erasure Coding (e.g. 10 Data pieces + 5 Parity pieces). This means your file is split across 15 different nodes globally. You only need ANY 10 nodes to stay online to achieve 100% data recovery with zero quality loss. If 5 nodes simultaneously explode, your file instantly reconstructs via the AI Sentinel triggering a self-repair operation.",
            icon: <Database className="text-purple-400 mb-4" size={32} />
        },
        {
            question: "Can node operators view or steal my files?",
            answer: "Impossible. Before a file ever leaves your browser, it is AES-256 encrypted using a key only you possess. The node only receives an encrypted, mathematical 'shard' of the full file. A single node does not have enough shards to reassemble the file, and even if they colluded with 9 other nodes, they still lack your private decryption key.",
            icon: <Shield className="text-green-400 mb-4" size={32} />
        }
    ];

    return (
        <div className="min-h-[calc(100vh-80px)] p-8 max-w-4xl mx-auto py-20">
            <div className="text-center mb-16">
                <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">Frequently Asked Questions</h1>
                <p className="text-lg text-muted">Learn how our Erasure Coding and AI architecture guarantees 100% data resilience.</p>
            </div>

            <div className="space-y-4">
                {faqs.map((faq, index) => {
                    const isOpen = openIndex === index;
                    return (
                        <div
                            key={index}
                            className={`glass-card transition-all duration-300 overflow-hidden border ${isOpen ? 'border-primary/50 bg-card/80' : 'border-border hover:border-border/80'}`}
                        >
                            <button
                                className="w-full text-left p-6 flex items-center justify-between focus:outline-none"
                                onClick={() => setOpenIndex(isOpen ? -1 : index)}
                            >
                                <span className="text-lg font-semibold">{faq.question}</span>
                                {isOpen ? <ChevronUp className="text-primary" /> : <ChevronDown className="text-muted" />}
                            </button>

                            <div
                                className={`transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
                            >
                                <div className="p-6 pt-0 text-gray-300 leading-relaxed flex flex-col md:flex-row gap-6 items-start border-t border-border/50 mt-2">
                                    <div className="hidden md:block shrink-0 mt-4 p-4 rounded-xl bg-background/50 border border-border">
                                        {faq.icon}
                                    </div>
                                    <p className="mt-4">{faq.answer}</p>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
