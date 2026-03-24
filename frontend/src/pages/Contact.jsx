import React, { useState } from "react";
import { Link } from "react-router-dom";
import { HardDrive, Mail, MapPin, Send, MessageSquare, CheckCircle2 } from "lucide-react";
import { toast } from "react-hot-toast";

export const Contact = () => {
    const [submitted, setSubmitted] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        setSubmitted(true);
        toast.success("Message sent! Our team will respond within 24 hours.", { icon: '✉️', duration: 4000 });
        setTimeout(() => setSubmitted(false), 3000);
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-800 pt-24 pb-12 relative overflow-hidden">
            <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-emerald-100/40 to-transparent pointer-events-none"></div>

            <div className="max-w-5xl mx-auto px-6 relative z-10">
                <div className="text-center mb-16">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-bold text-emerald-600 shadow-sm mb-6">
                        <MessageSquare size={14} /> Get In Touch
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display font-extrabold text-slate-900 mb-4 tracking-tight">
                        We're Here to Help
                    </h1>
                    <p className="text-lg text-slate-500 font-medium max-w-2xl mx-auto">
                        Whether you have a question about setting up a node, enterprise pricing, or our decentralized protocol, our team is ready.
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-8">
                    {/* Left: Contact Info Info Box */}
                    <div className="md:col-span-2 space-y-6">
                        <div className="glass-card p-8 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-3xl shadow-xl h-full flex flex-col justify-between border-0">
                            <div>
                                <h3 className="text-2xl font-bold font-display mb-6 text-white">Contact Information</h3>
                                <p className="text-emerald-100 mb-10 font-medium leading-relaxed">
                                    Fill out the form and our team will get back to you within 24 hours. For critical issues, please flag as urgent.
                                </p>

                                <div className="space-y-6">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/20">
                                            <Mail size={18} className="text-white" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-emerald-200 font-bold uppercase tracking-wider mb-0.5">Email Support</p>
                                            <p className="font-semibold text-white">support@neurostore.network</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/20">
                                            <MapPin size={18} className="text-white" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-emerald-200 font-bold uppercase tracking-wider mb-0.5">Headquarters</p>
                                            <p className="font-semibold text-white">San Francisco, CA<br />Global Decentralized Workforce</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-12 flex items-center gap-3 opacity-70">
                                <HardDrive size={24} />
                                <span className="font-display font-bold text-xl tracking-tight">NeuroStore</span>
                            </div>
                        </div>
                    </div>

                    {/* Right: Contact Form */}
                    <div className="md:col-span-3 glass-card bg-white p-8 md:p-10 rounded-3xl shadow-lg border border-slate-200">
                        <form className="space-y-6" onSubmit={handleSubmit}>
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700">First Name</label>
                                    <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium" placeholder="John" required />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-bold text-slate-700">Last Name</label>
                                    <input type="text" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium" placeholder="Doe" required />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700">Email Address</label>
                                <input type="email" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium" placeholder="john@company.com" required />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700">Topic</label>
                                <select className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-700 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium appearance-none">
                                    <option>General Inquiry</option>
                                    <option>Enterprise Deployment</option>
                                    <option>Node Provider Support</option>
                                    <option>Billing Question</option>
                                    <option>Security / Bug Report</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-bold text-slate-700">Message</label>
                                <textarea rows="4" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-medium resize-none" placeholder="How can we help you?" required></textarea>
                            </div>

                            <button type="submit" disabled={submitted} className={`w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-base shadow-lg hover:shadow-xl transition-all ${submitted ? 'bg-emerald-600 text-white' : 'btn-primary'}`}>
                                {submitted ? (<><CheckCircle2 size={18} /> Message Sent!</>) : (<>Send Message <Send size={18} /></>)}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
};
