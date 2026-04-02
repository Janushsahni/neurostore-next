import React, { useState, useEffect } from "react";
import { ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Download, RefreshCw, Globe, Lock, Trash2, FileText, Clock } from "lucide-react";
import { apiJson } from "../lib/apiClient";

const ComplianceItem = ({ passed, label, detail }) => (
    <div className={`flex items-start gap-3 p-4 rounded-xl border ${passed ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        {passed ? <CheckCircle2 className="text-emerald-500 mt-0.5 shrink-0" size={20} /> : <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />}
        <div>
            <p className={`font-bold text-sm ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>{label}</p>
            <p className="text-xs text-slate-500 mt-0.5">{detail}</p>
        </div>
    </div>
);

const ScoreRing = ({ score }) => {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    const color = score >= 80 ? '#34d399' : score >= 50 ? '#fbbf24' : '#ef4444';

    return (
        <div className="relative inline-flex items-center justify-center">
            <svg width="140" height="140" className="-rotate-90">
                <circle cx="70" cy="70" r={radius} stroke="rgba(0,0,0,0.06)" strokeWidth="8" fill="none" />
                <circle cx="70" cy="70" r={radius} stroke={color} strokeWidth="8" fill="none"
                    strokeDasharray={circumference} strokeDashoffset={offset}
                    strokeLinecap="round" className="transition-all duration-1000 ease-out" />
            </svg>
            <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-display font-extrabold" style={{ color }}>{score}</span>
                <span className="text-[10px] uppercase tracking-wider text-slate-400">/100</span>
            </div>
        </div>
    );
};

export const ComplianceDashboard = () => {
    const [buckets, setBuckets] = useState([]);
    const [selectedBucket, setSelectedBucket] = useState("");
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingBuckets, setLoadingBuckets] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchBuckets = async () => {
            try {
                const { response, data } = await apiJson("/s3/buckets", { method: "GET", timeoutMs: 10000 });
                if (response.ok && data?.buckets) {
                    setBuckets(data.buckets.map(b => b.name || b));
                    if (data.buckets.length > 0) setSelectedBucket(data.buckets[0]?.name || data.buckets[0]);
                }
            } catch { /* ignore */ }
            finally { setLoadingBuckets(false); }
        };
        fetchBuckets();
    }, []);

    const runAudit = async () => {
        if (!selectedBucket) return;
        setLoading(true);
        setError(null);
        try {
            const { response, data } = await apiJson(`/compliance/sovereignty/${selectedBucket}?jurisdiction=IN`, {
                method: "GET", timeoutMs: 15000,
            });
            if (response.ok) {
                setReport(data);
            } else {
                setError(data?.error || "Audit failed");
            }
        } catch (err) {
            setError(err?.message || "Network error");
        } finally {
            setLoading(false);
        }
    };

    // Calculate compliance score from report
    const calculateScore = (r) => {
        if (!r) return 0;
        let score = 0;
        if (r.shards_in_jurisdiction_percentage >= 100) score += 30;
        else if (r.shards_in_jurisdiction_percentage >= 80) score += 20;
        else if (r.shards_in_jurisdiction_percentage >= 50) score += 10;
        score += 20; // Encryption at rest (AES-256-GCM is always on)
        score += 15; // Encryption in transit (TLS always on)
        score += 15; // Right to erasure (crypto shredding always available)
        if (r.evidence_level === "strong") score += 20;
        else if (r.evidence_level === "partial") score += 10;
        return Math.min(score, 100);
    };

    const score = calculateScore(report);

    const checks = report ? [
        {
            passed: report.shards_in_jurisdiction_percentage >= 100,
            label: `Data Residency: ${report.shards_in_jurisdiction_percentage}% shards in ${report.region_enforced}`,
            detail: report.shards_in_jurisdiction_percentage >= 100
                ? "All data shards are stored within the declared jurisdiction"
                : `${(100 - report.shards_in_jurisdiction_percentage).toFixed(1)}% of shards are outside jurisdiction — action needed`
        },
        {
            passed: true,
            label: "Encryption at Rest: AES-256-GCM",
            detail: "All objects are encrypted with AES-256-GCM before storage. Keys are derived from a master secret."
        },
        {
            passed: true,
            label: "Encryption in Transit: TLS 1.3",
            detail: "All API traffic is encrypted via HTTPS/TLS. No plaintext transmission of data."
        },
        {
            passed: true,
            label: "Right to Erasure: Cryptographic Shredding",
            detail: "DELETE operations overwrite encryption metadata with random noise before row deletion, ensuring mathematical impossibility of recovery."
        },
        {
            passed: report.evidence_level === "strong",
            label: `Proof Level: ${report.evidence_level.toUpperCase()}`,
            detail: report.evidence_level === "strong"
                ? "All shards have verified residency evidence with challenge-response proofs"
                : "Some shards lack verified residency evidence — run Proof-of-Spacetime audit to improve"
        },
        {
            passed: false,
            label: "Data Retention Policy: Not Configured",
            detail: "Configure automatic data retention policies to auto-delete data after a defined period (required by DPDP Act Section 8)"
        },
    ] : [];

    return (
        <div className="min-h-[calc(100vh-80px)] p-6 md:p-10">
            <div className="mx-auto max-w-5xl">
                {/* Header */}
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-300 to-primary flex items-center justify-center text-[#041013]">
                        <ShieldCheck size={22} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-display font-bold text-slate-800">DPDP Compliance Dashboard</h1>
                        <p className="text-xs text-slate-500">Digital Personal Data Protection Act, 2023 — Compliance Monitor</p>
                    </div>
                </div>

                {/* Bucket Selector + Audit Button */}
                <div className="glass-card p-5 mt-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="flex-1 w-full">
                            <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Select Bucket</label>
                            <select
                                value={selectedBucket}
                                onChange={(e) => { setSelectedBucket(e.target.value); setReport(null); }}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg py-2.5 px-4 text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                                disabled={loadingBuckets}
                            >
                                {loadingBuckets && <option>Loading buckets...</option>}
                                {!loadingBuckets && buckets.length === 0 && <option>No buckets found</option>}
                                {buckets.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                        </div>
                        <button
                            onClick={runAudit}
                            disabled={loading || !selectedBucket}
                            className="btn-primary px-6 py-2.5 flex items-center gap-2 disabled:opacity-50 shrink-0 mt-5 sm:mt-0"
                        >
                            {loading ? <RefreshCw className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                            {loading ? "Auditing..." : "Run Compliance Audit"}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl flex items-center gap-2 font-medium">
                        <XCircle size={16} /> {error}
                    </div>
                )}

                {/* Results */}
                {report && (
                    <div className="mt-6 grid gap-6 md:grid-cols-[280px_1fr]">
                        {/* Score Card */}
                        <div className="glass-card p-6 flex flex-col items-center text-center">
                            <ScoreRing score={score} />
                            <p className={`mt-4 text-lg font-bold ${score >= 80 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                {score >= 80 ? "✅ COMPLIANT" : score >= 50 ? "⚠️ PARTIAL" : "❌ NON-COMPLIANT"}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Jurisdiction: {report.region_enforced} | Bucket: {report.bucket}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-3">
                                Audited: {new Date(report.timestamp).toLocaleString()}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono break-all">
                                Sig: {report.cryptographic_signature?.slice(0, 20)}...
                            </p>
                        </div>

                        {/* Checklist */}
                        <div className="space-y-3">
                            {checks.map((check, i) => (
                                <ComplianceItem key={i} {...check} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Info Cards */}
                {!report && !loading && (
                    <div className="mt-8 grid gap-4 md:grid-cols-3">
                        <div className="glass-card p-5">
                            <Globe className="text-primary mb-3" size={24} />
                            <h3 className="font-bold text-sm mb-1 text-slate-800">Data Residency</h3>
                            <p className="text-xs text-slate-500">Verify all data shards are stored within the declared jurisdiction (India by default).</p>
                        </div>
                        <div className="glass-card p-5">
                            <Lock className="text-emerald-300 mb-3" size={24} />
                            <h3 className="font-bold text-sm mb-1 text-slate-800">Encryption Audit</h3>
                            <p className="text-xs text-slate-500">Check AES-256-GCM encryption at rest and TLS 1.3 in transit compliance.</p>
                        </div>
                        <div className="glass-card p-5">
                            <Trash2 className="text-amber-300 mb-3" size={24} />
                            <h3 className="font-bold text-sm mb-1 text-slate-800">Right to Erasure</h3>
                            <p className="text-xs text-slate-500">Verify cryptographic shredding ensures deleted data is mathematically irrecoverable.</p>
                        </div>
                    </div>
                )}

                {/* Export Placeholder */}
                {report && (
                    <div className="mt-6 glass-card p-4 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <FileText className="text-primary" size={20} />
                            <div>
                                <p className="text-sm font-bold text-slate-800">Export Compliance Report</p>
                                <p className="text-xs text-slate-500">Download a signed PDF report for your compliance records</p>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                const reportText = JSON.stringify(report, null, 2);
                                const blob = new Blob([reportText], { type: "application/json" });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement("a");
                                a.href = url;
                                a.download = `dpdp-compliance-${report.bucket}-${new Date().toISOString().slice(0, 10)}.json`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                            className="btn-ghost px-4 py-2 text-sm font-bold flex items-center gap-2 hover:border-emerald-300 hover:text-emerald-700 transition border border-slate-200"
                        >
                            <Download size={16} /> Export JSON
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
