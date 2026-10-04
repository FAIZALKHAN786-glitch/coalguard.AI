import { useState } from "react";
import {
  Sparkles,
  ArrowUpRight,
  Send,
  Loader2,
  ShieldCheck,
  FileText,
  ChevronRight,
  TriangleAlert,
  Bot,
  Check,
} from "lucide-react";
import { downloadFile, useData, post, label, navigate } from "../lib";
import {
  PageHeading,
  Badge,
  Loading,
  ErrorBox,
  Empty,
  SectionHeader,
} from "./UI";
import type { Dashboard } from "../types";
type Answer = {
  answer: string;
  mode: string;
  sources: { id: string; name: string }[];
  retrieval: string;
  warning?: string;
};
export function Intelligence({ mine }: { mine: string }) {
  const {
    data: d,
    error,
    loading,
  } = useData<Dashboard>(`/dashboard?mine=${mine}`);
  const { data: integrations } = useData<any>("/integrations");
  const [question, setQuestion] = useState(""),
    [messages, setMessages] = useState<{ question: string; result: Answer }[]>(
      [],
    ),
    [busy, setBusy] = useState(false),
    [aiError, setAiError] = useState(""),
    [analysis, setAnalysis] = useState<any>(null),
    [analyzing, setAnalyzing] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (question.trim().length < 3) return;
    setBusy(true);
    setAiError("");
    try {
      const response = await post<Answer>("/ai/chat", {
        question,
        mineId: mine,
      });
      setMessages((m) => [...m, { question, result: response }]);
      setQuestion("");
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function review() {
    setAnalyzing(true);
    setAiError("");
    try {
      setAnalysis(await post("/ai/analysis", { mineId: mine }));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }
  return (
    <div>
      <PageHeading
        eyebrow="INTELLIGENCE, WITH ACCOUNTABILITY"
        title="A step ahead. Never on autopilot."
        description="Evidence-led insights that keep people in control."
      >
        <button
          className="button primary"
          disabled={analyzing}
          onClick={review}
        >
          {analyzing ? (
            <Loader2 size={17} className="spin" />
          ) : (
            <Sparkles size={17} />
          )}{" "}
          {analyzing ? "Reviewing…" : "Generate risk review"}
        </button>
      </PageHeading>
      <div className="ai-disclosure">
        <span className="icon-tile">
          <ShieldCheck size={21} />
        </span>
        <div>
          <strong>
            {integrations?.models?.decision
              ? "Decision model configured"
              : "Transparent rules. No black box."}
          </strong>
          <p>
            Risk signals are deterministic screening checks, not validated
            predictions or legal findings. AI guidance, when connected, is
            advisory and requires human review.
          </p>
        </div>
        <Badge value={integrations?.models?.text ? "active" : "pending"}>
          {integrations?.models?.text ? "AI configured" : "Rules active"}
        </Badge>
      </div>
      {integrations?.policy?.reason && (
        <div className="subtle-note" role="status">
          <ShieldCheck size={16} />
          <p>
            {integrations.policy.reason} Rule-based insights remain available
            without sending data to a model provider.
          </p>
        </div>
      )}
      {aiError && <ErrorBox message={aiError} />}
      {analysis && (
        <section className="panel analysis-result">
          <SectionHeader
            title="Your advisory risk review"
            subtitle={`${analysis.mode === "model" ? "AI-generated" : "Rule-based"} · ${new Date().toLocaleDateString("en-IN")}`}
          />
          <p>{analysis.summary}</p>
          {analysis.recommendations.map((r: any, i: number) => (
            <div className="recommendation" key={i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h4>{r.title}</h4>
                <p>{r.rationale}</p>
                <strong>Next step</strong>
                <p>{r.nextStep}</p>
              </div>
            </div>
          ))}
        </section>
      )}
      <div className="intelligence-grid">
        <section>
          <div className="inline-heading">
            <h3>What deserves a closer look</h3>
            <span>{d?.insights.length || 0} signals</span>
          </div>
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorBox message={error} />
          ) : !d?.insights.length ? (
            <section className="panel">
              <Empty
                title="No active screening signals"
                text="Continue reporting to keep your risk picture current."
              />
            </section>
          ) : (
            d.insights.map((s) => (
              <article className="panel signal-card" key={s.id}>
                <div>
                  <Badge value={s.severity} />
                  <span>{s.category}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <div className="signal-recommendation">
                  <Sparkles size={15} />
                  <p>{s.recommendation}</p>
                </div>
                <footer>
                  <span>
                    {s.evidence.length} supporting record
                    {s.evidence.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      navigate(
                        s.category === "Production"
                          ? "operation"
                          : s.category === "Environment"
                            ? "environment"
                            : "compliance",
                      )
                    }
                  >
                    Review records <ArrowUpRight size={14} />
                  </button>
                </footer>
                <details>
                  <summary>Evidence references</summary>
                  {s.evidence.map((id) => (
                    <code key={id}>{id}</code>
                  ))}
                </details>
              </article>
            ))
          )}
        </section>
        <section className="panel assistant-panel">
          <div className="assistant-heading">
            <span className="ai-avatar">
              <Sparkles size={22} />
            </span>
            <div>
              <h3>Your governance copilot</h3>
              <p>Clarity starts with a good question.</p>
            </div>
            <span className="tiny-dot" />
          </div>
          <div className="assistant-conversation">
            {!messages.length ? (
              <div className="assistant-welcome">
                <div className="assistant-orb">
                  <Sparkles size={31} />
                </div>
                <h3>
                  The bigger picture,
                  <br />a little closer.
                </h3>
                <p>
                  Explore your mine records and retrieve supporting evidence
                  from uploaded documents.
                </p>
                <div className="prompt-list">
                  {[
                    "Which compliance items need attention?",
                    "Summarize environmental risk signals.",
                    "What should we prioritize this week?",
                  ].map((q) => (
                    <button key={q} onClick={() => setQuestion(q)}>
                      {q}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div className="chat-turn" key={i}>
                  <div className="user-message">{m.question}</div>
                  <div className="assistant-message">
                    <div>
                      <Sparkles size={15} />
                      <strong>CoalGuard</strong>
                      <Badge value="low">
                        {m.result.mode === "model"
                          ? "AI-generated"
                          : "Rule-based"}
                      </Badge>
                    </div>
                    <p>{m.result.answer}</p>
                    {m.result.warning && <small>{m.result.warning}</small>}
                    {m.result.sources.length > 0 && (
                      <div className="source-list">
                        <strong>
                          Retrieved documents · {m.result.retrieval}
                        </strong>
                        {m.result.sources.map((s) => (
                          <a
                            key={s.id}
                            href={`/api/documents/${s.id}/download`}
                            onClick={(event) => {
                              event.preventDefault();
                              void downloadFile(
                                `/documents/${s.id}/download`,
                                s.name,
                              );
                            }}
                          >
                            <FileText size={13} />
                            {s.name}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {busy && (
              <div className="assistant-thinking">
                <Loader2 size={16} className="spin" /> Reviewing workspace
                evidence…
              </div>
            )}
          </div>
          <form className="assistant-input" onSubmit={ask}>
            <textarea
              aria-label="Ask the governance assistant"
              placeholder="Ask about your workspace…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={2000}
              rows={2}
            />
            <button
              className="send-button"
              aria-label="Send question"
              disabled={busy || question.trim().length < 3}
            >
              <Send size={17} />
            </button>
          </form>
          <div className="assistant-foot">
            <ShieldCheck size={12} />
            {integrations?.models?.text
              ? "Relevant workspace data is sent to your configured provider."
              : "No text model connected. Responses are rule-based summaries."}
          </div>
        </section>
      </div>
    </div>
  );
}
