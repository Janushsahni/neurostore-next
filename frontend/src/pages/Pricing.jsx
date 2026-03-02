import React, { useState } from "react";
import { Check, Zap, Shield, Building2, GraduationCap, Scale, BadgeIndianRupee, ArrowRight, Sparkles, Heart, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";

const plans = [
    {
        name: "Free",
        price: "₹0",
        period: "/forever",
        description: "For developers and students trying it out",
        badge: null,
        accent: "border-white/10",
        features: [
            "5 GB storage",
            "10 GB/mo egress",
            "S3-compatible API",
            "AES-256-GCM encryption",
            "Community support",
        ],
        cta: "Get Started Free",
        ctaStyle: "btn-ghost hover:border-primary/40 hover:text-white",
    },
    {
        name: "Pro",
        price: "₹499",
        period: "/month",
        description: "For startups and growing apps",
        badge: "Most Popular",
        accent: "border-primary/40 shadow-[0_0_30px_rgba(29,211,176,0.08)]",
        features: [
            "100 GB storage",
            "500 GB/mo egress",
            "S3-compatible API",
            "AES-256-GCM encryption",
            "DPDP compliance dashboard",
            "Webhook notifications",
            "Email support (24h SLA)",
            "Pay-per-second billing",
        ],
        cta: "Start Pro Trial",
        ctaStyle: "btn-primary",
    },
    {
        name: "Business",
        price: "₹4,999",
        period: "/month",
        description: "For companies with compliance needs",
        badge: null,
        accent: "border-white/10",
        features: [
            "1 TB storage",
            "5 TB/mo egress",
            "Everything in Pro",
            "Object versioning",
            "Custom retention policies",
            "Audit log export (CSV/PDF)",
            "Slack/Teams support",
            "99.9% SLA guarantee",
        ],
        cta: "Start Business Trial",
        ctaStyle: "btn-ghost hover:border-primary/40 hover:text-white",
    },
];

const verticals = [
    {
        icon: Heart,
        name: "HealthVault",
        tagline: "For Healthcare & Pharma",
        price: "₹9,999",
        period: "/month",
        color: "text-rose-400",
        borderColor: "border-rose-500/20",
        bgColor: "bg-rose-500/5",
        features: ["HIPAA-ready architecture", "PII auto-detection (Aadhaar/PAN)", "7-year data retention", "Audit trail for compliance", "Encrypted patient records"],
    },
    {
        icon: GraduationCap,
        name: "EduStore",
        tagline: "For EdTech & Universities",
        price: "₹4,999",
        period: "/month",
        color: "text-blue-400",
        borderColor: "border-blue-500/20",
        bgColor: "bg-blue-500/5",
        features: ["Video streaming optimization", "Auto-thumbnail generation", "Student storage quotas", "Bulk upload API", "Content delivery network"],
    },
    {
        icon: Scale,
        name: "LegalVault",
        tagline: "For Legal & Compliance",
        price: "₹14,999",
        period: "/month",
        color: "text-amber-400",
        borderColor: "border-amber-500/20",
        bgColor: "bg-amber-500/5",
        features: ["Immutable audit trail", "10-year retention default", "Document versioning", "eSign integration ready", "Court-grade chain of custody"],
    },
    {
        icon: BadgeIndianRupee,
        name: "FinStore",
        tagline: "For Fintech & Banking",
        price: "₹19,999",
        period: "/month",
        color: "text-emerald-400",
        borderColor: "border-emerald-500/20",
        bgColor: "bg-emerald-500/5",
        features: ["PCI DSS architecture", "RBI data localization proof", "90-day mandatory retention", "Encrypted backup snapshots", "Real-time audit webhook"],
    },
];

export const Pricing = () => {
    const [tab, setTab] = useState("plans"); // "plans" | "verticals"

    return (
        <div className="min-h-[calc(100vh-80px)] px-6 py-16 selection:bg-primary/30">
            <div className="mx-auto max-w-6xl">
                {/* Hero */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/8 px-4 py-2 text-xs font-semibold text-primary mb-4">
                        <Sparkles size={14} /> 40% Cheaper Than AWS S3 India
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display font-extrabold mb-4">
                        Simple, Transparent <span className="text-gradient">Pricing</span>
                    </h1>
                    <p className="text-muted max-w-2xl mx-auto">
                        Pay only for what you use. No hidden fees, no egress surprises. All plans include AES-256 encryption and Indian data residency.
                    </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex justify-center mb-10">
                    <div className="glass-card inline-flex p-1 gap-1">
                        <button
                            onClick={() => setTab("plans")}
                            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "plans" ? "bg-primary/20 text-primary" : "text-muted hover:text-white"}`}
                        >
                            Standard Plans
                        </button>
                        <button
                            onClick={() => setTab("verticals")}
                            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === "verticals" ? "bg-primary/20 text-primary" : "text-muted hover:text-white"}`}
                        >
                            Industry Solutions
                        </button>
                    </div>
                </div>

                {/* Standard Plans */}
                {tab === "plans" && (
                    <div className="grid gap-6 md:grid-cols-3">
                        {plans.map((plan) => (
                            <div key={plan.name} className={`glass-card p-7 relative flex flex-col ${plan.accent} transition-all hover:-translate-y-1`}>
                                {plan.badge && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="rounded-full bg-primary px-4 py-1 text-xs font-bold text-[#041013]">{plan.badge}</span>
                                    </div>
                                )}
                                <div className="mb-6">
                                    <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                                    <p className="text-xs text-muted">{plan.description}</p>
                                </div>
                                <div className="mb-6">
                                    <span className="text-4xl font-display font-extrabold">{plan.price}</span>
                                    <span className="text-sm text-muted">{plan.period}</span>
                                </div>
                                <ul className="space-y-3 mb-8 flex-1">
                                    {plan.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                                            <Check className="text-emerald-400 shrink-0" size={16} /> {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link to="/register" className={`w-full py-3 text-center font-semibold rounded-lg inline-flex items-center justify-center gap-2 transition-all ${plan.ctaStyle}`}>
                                    {plan.cta} <ArrowRight size={16} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}

                {/* Vertical Solutions */}
                {tab === "verticals" && (
                    <div className="grid gap-6 md:grid-cols-2">
                        {verticals.map((v) => (
                            <div key={v.name} className={`glass-card p-7 border ${v.borderColor} ${v.bgColor} transition-all hover:-translate-y-1`}>
                                <div className="flex items-center gap-3 mb-4">
                                    <div className={`inline-flex rounded-xl p-3 ${v.bgColor} ${v.color}`}>
                                        <v.icon size={22} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold">{v.name}</h3>
                                        <p className="text-xs text-muted">{v.tagline}</p>
                                    </div>
                                </div>
                                <div className="mb-5">
                                    <span className={`text-3xl font-display font-extrabold ${v.color}`}>{v.price}</span>
                                    <span className="text-sm text-muted">{v.period}</span>
                                </div>
                                <ul className="space-y-2.5 mb-6">
                                    {v.features.map((f, i) => (
                                        <li key={i} className="flex items-center gap-2 text-sm text-gray-300">
                                            <Check className={`${v.color} shrink-0`} size={15} /> {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link to="/register" className={`w-full py-2.5 text-center text-sm font-semibold rounded-lg inline-flex items-center justify-center gap-2 btn-ghost ${v.borderColor} hover:text-white transition-all`}>
                                    Contact Sales <ArrowRight size={16} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}

                {/* Enterprise CTA */}
                <div className="glass-card mt-10 p-8 text-center">
                    <Building2 className="mx-auto text-primary mb-4" size={32} />
                    <h3 className="text-2xl font-display font-bold mb-2">Enterprise</h3>
                    <p className="text-muted text-sm max-w-xl mx-auto mb-6">
                        Need custom SLAs, dedicated infrastructure, white-label API, or ISO 27001 compliance?
                        We build custom solutions for large organizations.
                    </p>
                    <a href="mailto:sales@neurostore.in" className="btn-primary px-8 py-3 inline-flex items-center gap-2">
                        Talk to Sales <ArrowRight size={18} />
                    </a>
                </div>

                {/* Comparison with AWS */}
                <div className="mt-12 glass-card p-7">
                    <h3 className="text-lg font-bold mb-4 text-center">NeuroStore vs AWS S3 (Mumbai Region)</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="text-left py-3 px-4 text-muted font-semibold">Feature</th>
                                    <th className="text-center py-3 px-4 text-primary font-semibold">NeuroStore</th>
                                    <th className="text-center py-3 px-4 text-gray-400 font-semibold">AWS S3</th>
                                </tr>
                            </thead>
                            <tbody className="text-gray-300">
                                <tr className="border-b border-white/5"><td className="py-3 px-4">Storage (per GB/mo)</td><td className="text-center py-3 px-4 text-emerald-300 font-semibold">₹0.80</td><td className="text-center py-3 px-4">₹1.75</td></tr>
                                <tr className="border-b border-white/5"><td className="py-3 px-4">Egress (per GB)</td><td className="text-center py-3 px-4 text-emerald-300 font-semibold">₹0.50</td><td className="text-center py-3 px-4">₹1.20</td></tr>
                                <tr className="border-b border-white/5"><td className="py-3 px-4">DPDP Compliance Dashboard</td><td className="text-center py-3 px-4 text-emerald-300">✅</td><td className="text-center py-3 px-4 text-red-400">❌</td></tr>
                                <tr className="border-b border-white/5"><td className="py-3 px-4">Pay-per-second Billing</td><td className="text-center py-3 px-4 text-emerald-300">✅</td><td className="text-center py-3 px-4 text-red-400">❌</td></tr>
                                <tr className="border-b border-white/5"><td className="py-3 px-4">Webhook Notifications</td><td className="text-center py-3 px-4 text-emerald-300">✅</td><td className="text-center py-3 px-4 text-amber-300">Lambda required</td></tr>
                                <tr><td className="py-3 px-4">Data Sovereignty Proof</td><td className="text-center py-3 px-4 text-emerald-300">✅ Signed report</td><td className="text-center py-3 px-4 text-red-400">❌</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
