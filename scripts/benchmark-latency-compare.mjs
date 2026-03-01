#!/usr/bin/env node
import crypto from "node:crypto";
import process from "node:process";

function required(name) {
    const v = process.env[name];
    if (!v) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return v;
}

function percentile(values, p) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

function stats(values) {
    const sum = values.reduce((a, b) => a + b, 0);
    return {
        avg: values.length ? sum / values.length : 0,
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        p99: percentile(values, 99),
        min: values.length ? Math.min(...values) : 0,
        max: values.length ? Math.max(...values) : 0,
    };
}

async function timedFetch(url, init) {
    const start = performance.now();
    const res = await fetch(url, init);
    const elapsed = performance.now() - start;
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} for ${url.slice(0, 80)}: ${body.slice(0, 120)}`);
    }
    return elapsed;
}

async function benchmark(name, putUrl, getUrl, payload, runs) {
    const putLat = [];
    const getLat = [];

    for (let i = 0; i < 3; i++) {
        await timedFetch(putUrl, { method: "PUT", body: payload, headers: { "content-type": "application/octet-stream" } });
        await timedFetch(getUrl, { method: "GET" });
    }

    for (let i = 0; i < runs; i++) {
        const putMs = await timedFetch(putUrl, {
            method: "PUT",
            body: payload,
            headers: { "content-type": "application/octet-stream" },
        });
        const getMs = await timedFetch(getUrl, { method: "GET" });
        putLat.push(putMs);
        getLat.push(getMs);
        process.stdout.write(`${name} run ${i + 1}/${runs}: put=${putMs.toFixed(1)}ms get=${getMs.toFixed(1)}ms\n`);
    }

    return {
        put: stats(putLat),
        get: stats(getLat),
    };
}

function printReport(name, result) {
    const put = result.put;
    const get = result.get;
    console.log(`\n[${name}]`);
    console.log(`PUT  avg=${put.avg.toFixed(1)}ms p50=${put.p50.toFixed(1)} p95=${put.p95.toFixed(1)} p99=${put.p99.toFixed(1)} min=${put.min.toFixed(1)} max=${put.max.toFixed(1)}`);
    console.log(`GET  avg=${get.avg.toFixed(1)}ms p50=${get.p50.toFixed(1)} p95=${get.p95.toFixed(1)} p99=${get.p99.toFixed(1)} min=${get.min.toFixed(1)} max=${get.max.toFixed(1)}`);
}

async function main() {
    const neuroPutUrl = required("NEURO_PUT_URL");
    const neuroGetUrl = required("NEURO_GET_URL");
    const awsPutUrl = required("AWS_PUT_URL");
    const awsGetUrl = required("AWS_GET_URL");

    const runs = parseInt(process.env.BENCH_RUNS || "20", 10);
    const bytes = parseInt(process.env.BENCH_BYTES || String(2 * 1024 * 1024), 10);
    const payload = crypto.randomBytes(bytes);

    console.log(`Running benchmark with payload=${bytes} bytes, runs=${runs}`);
    console.log("Tip: use fresh pre-signed URLs for each benchmark session.");

    const neuro = await benchmark("NeuroStore", neuroPutUrl, neuroGetUrl, payload, runs);
    const aws = await benchmark("AWS S3", awsPutUrl, awsGetUrl, payload, runs);

    printReport("NeuroStore", neuro);
    printReport("AWS S3", aws);

    const deltaPutP95 = aws.put.p95 - neuro.put.p95;
    const deltaGetP95 = aws.get.p95 - neuro.get.p95;
    console.log("\nDelta (AWS - NeuroStore):");
    console.log(`PUT p95 delta: ${deltaPutP95.toFixed(1)}ms (${deltaPutP95 > 0 ? "NeuroStore faster" : "AWS faster"})`);
    console.log(`GET p95 delta: ${deltaGetP95.toFixed(1)}ms (${deltaGetP95 > 0 ? "NeuroStore faster" : "AWS faster"})`);
}

main().catch((err) => {
    console.error("Benchmark failed:", err.message);
    process.exit(1);
});
