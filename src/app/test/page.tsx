"use client";

import { useState } from "react";
import type { AiAnalysis } from "@/lib/types";

const SAMPLE_INSTRUCTIONS = `You are replying for "Sunrise Dental Clinic" in Pune.
Be warm, professional, and concise (under 40 words).
Reply in the same language/script the patient used.
Mention that they can book an appointment by calling the clinic or via the link in bio.`;

const SAMPLES = [
  "Bohot accha experience tha, doctor ne bahut dhyaan se dekha. Thank you!",
  "Worst service ever. Waited 2 hours and the doctor was rude. Never coming back.",
  "क्या आपके यहाँ रविवार को भी अपॉइंटमेंट मिल सकता है?",
  "Check out my page for free followers!!! www.spam-link.example",
];

export default function TestAiPage() {
  const [comment, setComment] = useState(SAMPLES[0]);
  const [instructions, setInstructions] = useState(SAMPLE_INSTRUCTIONS);
  const [result, setResult] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/dev/test-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment, instructions }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Request failed");
      setResult(data.analysis as AiAnalysis);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <h1>AI Engine Test</h1>
      <p className="subtitle">
        Test the sentiment/language detection + reply generation directly. Only requires{" "}
        <code>GEMINI_API_KEY</code> in <code>.env.local</code> — no Supabase or platform setup needed.
      </p>

      <div className="card">
        <label style={{ fontSize: 13, fontWeight: 600 }}>Client instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          style={{ minHeight: 100, marginTop: 6, marginBottom: 14 }}
        />

        <label style={{ fontSize: 13, fontWeight: 600 }}>Comment to test</label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          style={{ marginTop: 6 }}
        />

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              onClick={() => setComment(s)}
              style={{ background: "#eee", color: "#444", fontSize: 12 }}
            >
              Sample {i + 1}
            </button>
          ))}
        </div>

        <div className="actions">
          <button className="btn-approve" onClick={run} disabled={loading || !comment.trim()}>
            {loading ? "Analyzing…" : "Analyze & Generate Reply"}
          </button>
        </div>

        {error && <div className="reasoning" style={{ color: "#b3261e" }}>Error: {error}</div>}
      </div>

      {result && (
        <div className="card">
          <div className="card-header">
            <span>
              Language: <strong>{result.language}</strong> · Intent: <strong>{result.intent}</strong>
            </span>
            <span className={`badge badge-${result.sentiment}`}>{result.sentiment}</span>
          </div>

          <label style={{ fontSize: 13, fontWeight: 600 }}>
            {result.shouldAutoReply ? "✅ Would auto-reply with:" : "⚠️ Flagged for human review — suggested reply:"}
          </label>
          <div className="original-text">{result.reply || "(no reply suggested — likely spam)"}</div>

          <div className="reasoning">AI reasoning: {result.reasoning}</div>
        </div>
      )}
    </div>
  );
}
