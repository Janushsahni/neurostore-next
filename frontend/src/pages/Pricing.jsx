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
        accent: "border-slate-200 bg-white shadow-sm",
        features: [
            "5 GB storage",
            "10 GB/mo egress",
            "S3-compatible API",
            "AES-256-GCM encryption",
            "Community support",
        ],
        cta: "Get Started Free",
        ctaStyle: "bg-white border text-emerald-600 border-emerald-200 hover:bg-emerald-50",
    },
    {
        name: "Pro",
        price: "₹499",
        period: "/month",
        description: "For startups and growing apps",
        badge: "Most Popular",
        accent: "border-emerald-300 bg-emerald-50/50 shadow-md",
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
        accent: "border-slate-200 bg-white shadow-sm",
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
        ctaStyle: "bg-white border text-emerald-600 border-emerald-200 hover:bg-emerald-50",
    },
];

const verticals = [
    {
        icon: Heart,
        name: "HealthVault",
        tagline: "For Healthcare & Pharma",
        price: "₹9,999",
        period: "/month",
        color: "text-rose-600",
        borderColor: "border-rose-200",
        bgColor: "bg-rose-50",
        features: ["HIPAA-ready architecture", "PII auto-detection (Aadhaar/PAN)", "7-year data retention", "Audit trail for compliance", "Encrypted patient records"],
    },
    {
        icon: GraduationCap,
        name: "EduStore",
        tagline: "For EdTech & Universities",
        price: "₹4,999",
        period: "/month",
        color: "text-blue-600",
        borderColor: "border-blue-200",
        bgColor: "bg-blue-50",
        features: ["Video streaming optimization", "Auto-thumbnail generation", "Student storage quotas", "Bulk upload API", "Content delivery network"],
    },
    {
        icon: Scale,
        name: "LegalVault",
        tagline: "For Legal & Compliance",
        price: "₹14,999",
        period: "/month",
        color: "text-amber-600",
        borderColor: "border-amber-200",
        bgColor: "bg-amber-50",
        features: ["Immutable audit trail", "10-year retention default", "Document versioning", "eSign integration ready", "Court-grade chain of custody"],
    },
    {
        icon: BadgeIndianRupee,
        name: "FinStore",
        tagline: "For Fintech & Banking",
        price: "₹19,999",
        period: "/month",
        color: "text-emerald-600",
        borderColor: "border-emerald-200",
        bgColor: "bg-emerald-50",
        features: ["PCI DSS architecture", "RBI data localization proof", "90-day mandatory retention", "Encrypted backup snapshots", "Real-time audit webhook"],
    },
];

export const Pricing = () => {
    const [tab, setTab] = useState("plans"); // "plans" | "verticals"

    return (
        <div className="min-h-[calc(100vh-80px)] px-6 py-16 bg-slate-50 selection:bg-emerald-500/30 text-slate-800">
            <div className="mx-auto max-w-6xl">
                {/* Hero */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 mb-4 shadow-sm">
                        <Sparkles size={14} className="text-emerald-500" /> 40% Cheaper Than AWS S3 India
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display font-bold mb-4 text-slate-900">
                        Simple, Transparent Pricing
                    </h1>
                    <p className="text-slate-500 font-medium max-w-2xl mx-auto">
                        Pay only for what you use. No hidden fees, no egress surprises. All plans include AES-256 encryption and Indian data residency.
                    </p>
                </div>

                {/* Tab Switcher */}
                <div className="flex justify-center mb-10">
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-1.5 inline-flex gap-1">
                        <button
                            onClick={() => setTab("plans")}
                            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "plans" ? "bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`}
                        >
                            Standard Plans
                        </button>
                        <button
                            onClick={() => setTab("verticals")}
                            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "verticals" ? "bg-emerald-50 text-emerald-700 shadow-sm border border-emerald-100" : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`}
                        >
                            Industry Solutions
                        </button>
                    </div>
                </div>

                {/* Standard Plans */}
                {tab === "plans" && (
                    <div className="grid gap-6 md:grid-cols-3">
                        {plans.map((plan) => (
                            <div key={plan.name} className={`rounded-3xl border p-8 relative flex flex-col ${plan.accent} transition-all hover:-translate-y-1 hover:shadow-lg`}>
                                {plan.badge && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                        <span className="rounded-full bg-emerald-500 px-4 py-1 text-xs font-bold text-white shadow-md">{plan.badge}</span>
                                    </div>
                                )}
                                <div className="mb-6">
                                    <h3 className="text-2xl font-bold mb-2 text-slate-800">{plan.name}</h3>
                                    <p className="text-sm text-slate-500 font-medium">{plan.description}</p>
                                </div>
                                <div className="mb-8">
                                    <span className="text-4xl font-display font-extrabold text-slate-900">{plan.price}</span>
                                    <span className="text-sm font-medium text-slate-500 block mt-1">{plan.period}</span>
                                </div>
                                <ul className="space-y-4 mb-8 flex-1">
                                    {plan.features.map((f, i) => (
                                        <li key={i} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                                            <Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link to="/register" className={`w-full py-3.5 text-center font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-all ${plan.ctaStyle}`}>
                                    {plan.cta} <ArrowRight size={18} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}

                {/* Vertical Solutions */}
                {tab === "verticals" && (
                    <div className="grid gap-6 md:grid-cols-2">
                        {verticals.map((v) => (
                            <div key={v.name} className={`rounded-3xl border bg-white p-8 ${v.borderColor} transition-all hover:-translate-y-1 hover:shadow-md`}>
                                <div className="flex items-center gap-4 mb-6">
                                    <div className={`inline-flex rounded-2xl p-4 ${v.bgColor} ${v.color}`}>
                                        <v.icon size={28} />
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-bold text-slate-800">{v.name}</h3>
                                        <p className="text-sm font-medium text-slate-500">{v.tagline}</p>
                                    </div>
                                </div>
                                <div className="mb-6">
                                    <span className={`text-3xl font-display font-extrabold ${v.color}`}>{v.price}</span>
                                    <span className="text-sm font-medium text-slate-500 block mt-1">{v.period}</span>
                                </div>
                                <ul className="space-y-3 mb-8">
                                    {v.features.map((f, i) => (
                                        <li key={i} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                                            <Check className={`${v.color} shrink-0 mt-0.5`} size={18} /> {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link to="/register" className={`w-full py-3.5 text-center text-sm font-bold rounded-xl inline-flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-white hover:border-emerald-300 hover:text-emerald-700 transition-all`}>
                                    Contact Sales <ArrowRight size={18} />
                                </Link>
                            </div>
                        ))}
                    </div>
                )}

                {/* Enterprise CTA */}
                <div className="bg-white border border-slate-200 rounded-3xl mt-16 p-10 text-center shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-50 rounded-full blur-3xl -mr-20 -mt-20 z-0"></div>
                    <div className="relative z-10">
                        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
                            <Building2 className="text-emerald-600" size={32} />
                        </div>
                        <h3 className="text-3xl font-display font-bold mb-3 text-slate-800">Enterprise Solutions</h3>
                        <p className="text-slate-500 font-medium text-base max-w-2xl mx-auto mb-8">
                            Need custom SLAs, dedicated infrastructure, white-label API, or ISO 27001 compliance?
                            We build custom solutions for large organizations.
                        </p>
                        <a href="mailto:sales@secventra.com" className="btn-primary px-8 py-4 rounded-xl rounded-xl inline-flex items-center gap-2 font-bold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30">
                            Talk to Enterprise Sales <ArrowRight size={20} />
                        </a>
                    </div>
                </div>

                {/* Comparison with AWS */}
                <div className="mt-16 bg-white border border-slate-200 rounded-3xl p-8 shadow-sm">
                    <h3 className="text-xl font-bold mb-6 text-center text-slate-800">NeuroStore vs AWS S3 (Mumbai Region)</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50">
                                    <th className="text-left py-4 px-6 text-slate-500 font-bold rounded-tl-xl">Feature</th>
                                    <th className="text-center py-4 px-6 text-emerald-700 font-bold">NeuroStore</th>
                                    <th className="text-center py-4 px-6 text-slate-500 font-bold rounded-tr-xl">AWS S3</th>
                                </tr>
                            </thead>
                            <tbody className="text-slate-700 font-medium">
                                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="py-4 px-6">Storage (per GB/mo)</td><td className="text-center py-4 px-6 text-emerald-600 font-bold bg-emerald-50/50">₹0.80</td><td className="text-center py-4 px-6">₹1.75</td></tr>
                                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="py-4 px-6">Egress (per GB)</td><td className="text-center py-4 px-6 text-emerald-600 font-bold bg-emerald-50/50">₹0.50</td><td className="text-center py-4 px-6">₹1.20</td></tr>
                                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="py-4 px-6">DPDP Compliance Dashboard</td><td className="text-center py-4 px-6 text-emerald-600 bg-emerald-50/50">✅ Built-in</td><td className="text-center py-4 px-6 text-slate-400">❌ Complex Setup</td></tr>
                                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="py-4 px-6">Pay-per-second Billing</td><td className="text-center py-4 px-6 text-emerald-600 bg-emerald-50/50">✅ Yes</td><td className="text-center py-4 px-6 text-slate-400">❌ No</td></tr>
                                <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors"><td className="py-4 px-6">Webhook Notifications</td><td className="text-center py-4 px-6 text-emerald-600 bg-emerald-50/50">✅ Native API</td><td className="text-center py-4 px-6 text-amber-500">Lambda required</td></tr>
                                <tr className="hover:bg-slate-50 transition-colors"><td className="py-4 px-6">Data Sovereignty Proof</td><td className="text-center py-4 px-6 text-emerald-600 font-bold bg-emerald-50/50">✅ Cryptographic Report</td><td className="text-center py-4 px-6 text-slate-400">❌ Not verifiable</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};
