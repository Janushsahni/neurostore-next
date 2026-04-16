import React, { useState } from "react";
import { Check, Building2, GraduationCap, Scale, BadgeIndianRupee, ArrowRight, Sparkles, Heart, X, CreditCard, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";

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
        accent: "border-emerald-300 bg-emerald-50/50 shadow-md ring-2 ring-emerald-200/50",
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

const cardVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: (i) => ({
        opacity: 1,
        y: 0,
        transition: { duration: 0.5, delay: i * 0.12, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
};

// ── Billing Modal ──
const BillingModal = ({ plan, onClose }) => {
    const [step, setStep] = useState(1); // 1=confirm, 2=payment, 3=success

    return (
        <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <Motion.div
                initial={{ scale: 0.92, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.92, opacity: 0, y: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-slate-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-slate-900 p-6 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-40 h-40 bg-emerald-500/20 rounded-full blur-3xl -mr-16 -mt-16"></div>
                    <div className="relative z-10 flex items-center justify-between">
                        <div>
                            <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest mb-1">Upgrade Plan</p>
                            <h3 className="text-2xl font-display font-extrabold text-white">{plan.name} — {plan.price}{plan.period}</h3>
                        </div>
                        <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors text-white">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Body */}
                <div className="p-6">
                    <AnimatePresence mode="wait">
                        {step === 1 && (
                            <Motion.div key="confirm" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                <p className="text-sm text-slate-600 font-medium mb-4">You're about to activate the <strong className="text-slate-900">{plan.name}</strong> plan with the following benefits:</p>
                                <ul className="space-y-2.5 mb-6">
                                    {plan.features.map((f, i) => (
                                        <Motion.li
                                            key={i}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.05 }}
                                            className="flex items-center gap-2.5 text-sm font-medium text-slate-700"
                                        >
                                            <Check size={16} className="text-emerald-500 shrink-0" /> {f}
                                        </Motion.li>
                                    ))}
                                </ul>
                                <button
                                    onClick={() => setStep(2)}
                                    className="w-full py-3.5 btn-primary rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                                >
                                    <CreditCard size={18} /> Continue to Payment
                                </button>
                            </Motion.div>
                        )}

                        {step === 2 && (
                            <Motion.div key="payment" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Card Number</label>
                                        <input type="text" placeholder="4242 4242 4242 4242" maxLength={19} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Expiry</label>
                                            <input type="text" placeholder="MM/YY" maxLength={5} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all" />
                                        </div>
                                        <div>
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">CVC</label>
                                            <input type="text" placeholder="123" maxLength={3} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all" />
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs text-emerald-700 font-medium">
                                        <Lock size={14} className="shrink-0" /> Card details are processed securely by Razorpay. We never store your card information.
                                    </div>
                                </div>
                                <button
                                    onClick={() => setStep(3)}
                                    className="w-full mt-5 py-3.5 btn-primary rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                                >
                                    Pay {plan.price} Now <ArrowRight size={18} />
                                </button>
                            </Motion.div>
                        )}

                        {step === 3 && (
                            <Motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-6">
                                <Motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }}
                                    className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5"
                                >
                                    <Check size={40} className="text-emerald-500" />
                                </Motion.div>
                                <h4 className="text-2xl font-display font-extrabold text-slate-900 mb-2">You're on {plan.name}! 🎉</h4>
                                <p className="text-sm text-slate-500 font-medium mb-6">Your storage quota has been upgraded immediately. Start uploading to your expanded vault.</p>
                                <Link
                                    to="/dashboard/drive"
                                    className="btn-primary px-8 py-3 rounded-xl font-bold text-sm inline-flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                                >
                                    Go to Dashboard <ArrowRight size={18} />
                                </Link>
                            </Motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </Motion.div>
        </Motion.div>
    );
};

export const Pricing = () => {
    const [tab, setTab] = useState("plans");
    const [billingPlan, setBillingPlan] = useState(null);

    return (
        <div className="min-h-[calc(100vh-80px)] px-6 py-16 bg-slate-50 selection:bg-emerald-500/30 text-slate-800">
            <div className="mx-auto max-w-6xl">
                {/* Hero */}
                <Motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="text-center mb-12"
                >
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 mb-4 shadow-sm">
                        <Sparkles size={14} className="text-emerald-500" /> 40% Cheaper Than AWS S3 India
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display font-bold mb-4 text-slate-900">
                        Simple, Transparent Pricing
                    </h1>
                    <p className="text-slate-500 font-medium max-w-2xl mx-auto">
                        Pay only for what you use. No hidden fees, no egress surprises. All plans include AES-256 encryption and Indian data residency.
                    </p>
                </Motion.div>

                {/* Animated Tab Switcher */}
                <div className="flex justify-center mb-10">
                    <div className="bg-white border border-slate-200 shadow-sm rounded-xl p-1.5 inline-flex gap-1 relative">
                        <button
                            onClick={() => setTab("plans")}
                            className={`relative z-10 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "plans" ? "text-emerald-700" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            Standard Plans
                        </button>
                        <button
                            onClick={() => setTab("verticals")}
                            className={`relative z-10 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "verticals" ? "text-emerald-700" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            Industry Solutions
                        </button>
                        {/* Animated pill indicator */}
                        <Motion.div
                            layoutId="pricing-tab-pill"
                            className="absolute top-1.5 h-[calc(100%-12px)] bg-emerald-50 rounded-lg border border-emerald-100 shadow-sm"
                            style={{
                                left: tab === "plans" ? 6 : "calc(50%)",
                                width: "calc(50% - 6px)",
                            }}
                            transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        />
                    </div>
                </div>

                {/* Standard Plans */}
                <AnimatePresence mode="wait">
                    {tab === "plans" && (
                        <Motion.div
                            key="plans"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="grid gap-6 md:grid-cols-3"
                        >
                            {plans.map((plan, i) => (
                                <Motion.div
                                    key={plan.name}
                                    custom={i}
                                    variants={cardVariants}
                                    initial="hidden"
                                    animate="visible"
                                    whileHover={{ y: -6, transition: { duration: 0.2 } }}
                                    className={`rounded-3xl border p-8 relative flex flex-col ${plan.accent} transition-shadow hover:shadow-xl`}
                                >
                                    {plan.badge && (
                                        <Motion.div
                                            initial={{ scale: 0, y: 10 }}
                                            animate={{ scale: 1, y: 0 }}
                                            transition={{ type: "spring", stiffness: 400, damping: 15, delay: 0.4 }}
                                            className="absolute -top-3 left-1/2 -translate-x-1/2"
                                        >
                                            <span className="rounded-full bg-emerald-500 px-4 py-1 text-xs font-bold text-white shadow-md shadow-emerald-500/30">{plan.badge}</span>
                                        </Motion.div>
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
                                        {plan.features.map((f, j) => (
                                            <li key={j} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                                                <Check className="text-emerald-500 shrink-0 mt-0.5" size={18} /> {f}
                                            </li>
                                        ))}
                                    </ul>
                                    {plan.price === "₹0" ? (
                                        <Link to="/register" className={`w-full py-3.5 text-center font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-all ${plan.ctaStyle}`}>
                                            {plan.cta} <ArrowRight size={18} />
                                        </Link>
                                    ) : (
                                        <button
                                            onClick={() => setBillingPlan(plan)}
                                            className={`w-full py-3.5 text-center font-bold rounded-xl inline-flex items-center justify-center gap-2 transition-all ${plan.ctaStyle}`}
                                        >
                                            {plan.cta} <ArrowRight size={18} />
                                        </button>
                                    )}
                                </Motion.div>
                            ))}
                        </Motion.div>
                    )}

                    {/* Vertical Solutions */}
                    {tab === "verticals" && (
                        <Motion.div
                            key="verticals"
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -15 }}
                            transition={{ duration: 0.3 }}
                            className="grid gap-6 md:grid-cols-2"
                        >
                            {verticals.map((v, i) => (
                                <Motion.div
                                    key={v.name}
                                    custom={i}
                                    variants={cardVariants}
                                    initial="hidden"
                                    animate="visible"
                                    whileHover={{ y: -4, transition: { duration: 0.2 } }}
                                    className={`rounded-3xl border bg-white p-8 ${v.borderColor} transition-shadow hover:shadow-lg`}
                                >
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
                                        {v.features.map((f, j) => (
                                            <li key={j} className="flex items-start gap-3 text-sm font-medium text-slate-600">
                                                <Check className={`${v.color} shrink-0 mt-0.5`} size={18} /> {f}
                                            </li>
                                        ))}
                                    </ul>
                                    <button
                                        onClick={() => setBillingPlan({ ...v, ctaStyle: '', cta: 'Contact Sales' })}
                                        className="w-full py-3.5 text-center text-sm font-bold rounded-xl inline-flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-white hover:border-emerald-300 hover:text-emerald-700 transition-all"
                                    >
                                        Contact Sales <ArrowRight size={18} />
                                    </button>
                                </Motion.div>
                            ))}
                        </Motion.div>
                    )}
                </AnimatePresence>

                {/* Enterprise CTA */}
                <Motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-80px" }}
                    transition={{ duration: 0.6 }}
                    className="bg-white border border-slate-200 rounded-3xl mt-16 p-10 text-center shadow-sm relative overflow-hidden"
                >
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
                        <a href="mailto:sales@secventra.com" className="btn-primary px-8 py-4 rounded-xl inline-flex items-center gap-2 font-bold shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30">
                            Talk to Enterprise Sales <ArrowRight size={20} />
                        </a>
                    </div>
                </Motion.div>

                {/* Comparison with AWS */}
                <Motion.div
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-80px" }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className="mt-16 bg-white border border-slate-200 rounded-3xl p-8 shadow-sm"
                >
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
                </Motion.div>
            </div>

            {/* Billing Modal */}
            <AnimatePresence>
                {billingPlan && <BillingModal plan={billingPlan} onClose={() => setBillingPlan(null)} />}
            </AnimatePresence>
        </div>
    );
};

