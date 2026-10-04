import { useState, useRef } from "react";
import {
  Upload,
  FileText,
  Download,
  ScanText,
  Search,
  RotateCw,
  Copy,
  Loader2,
} from "lucide-react";
import {
  downloadFile,
  useData,
  api,
  post,
  refresh,
  dateLabel,
  fmt,
} from "../lib";
import { PageHeading, Badge, Loading, ErrorBox, Empty, Modal } from "./UI";
import type { Doc, Mine, User } from "../types";
export function Documents({
  mine,
  mines,
  user,
  toast,
}: {
  mine: string;
  mines: Mine[];
  user: User;
  toast: (s: string) => void;
}) {
  const { data, loading, error, reload } = useData<Doc[]>(
    `/documents?mine=${mine}`,
  );
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Doc | null>(null),
    [uploading, setUploading] = useState(false),
    [uploadMine, setUploadMine] = useState(
      mine === "all" ? mines[0]?.id || "" : mine,
    ),
    [uploadError, setUploadError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const write = ["admin", "officer"].includes(user.role);
  async function upload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File exceeds the 10 MB limit.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mineId", uploadMine);
      await api("/documents", { method: "POST", body: form });
      refresh();
      toast("Document uploaded. Text extraction runs in the background.");
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }
  const rows =
    data?.filter((d) => d.name.toLowerCase().includes(query.toLowerCase())) ||
    [];
  return (
    <div>
      <PageHeading
        eyebrow="PAPERLESS, BY DESIGN"
        title="The evidence behind every decision."
        description="A secure home for documents, digitized and ready to retrieve."
      />
      {write && (
        <section
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0] && !uploading)
              void upload(e.dataTransfer.files[0]);
          }}
        >
          <span className="upload-icon">
            <ScanText size={32} />
          </span>
          <div>
            <h3>From paperwork to perspective.</h3>
            <p>Drop a document here, or choose a file to upload.</p>
            <small>
              PDF, PNG, JPEG or TXT · Up to 10 MB · English image OCR
            </small>
          </div>
          <div>
            <select
              aria-label="Document mine"
              value={uploadMine}
              onChange={(e) => setUploadMine(e.target.value)}
              required
            >
              <option value="" disabled>
                Select mine
              </option>
              {mines.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={uploading || !uploadMine}
              onClick={() => input.current?.click()}
            >
              {uploading ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Upload size={16} />
              )}{" "}
              {uploading ? "Uploading…" : "Choose document"}
            </button>
          </div>
          <input
            ref={input}
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.txt"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </section>
      )}
      {uploadError && <ErrorBox message={uploadError} />}
      <section className="panel records-panel">
        <div className="records-toolbar">
          <div>
            <h3>Document library</h3>
            <small className="muted">
              {data?.length || 0} documents · private, role-scoped storage
            </small>
          </div>
          <div className="input-search">
            <Search size={16} />
            <input
              placeholder="Find a document…"
              aria-label="Search documents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {error ? (
          <ErrorBox message={error} retry={reload} />
        ) : loading ? (
          <Loading />
        ) : !rows.length ? (
          <Empty
            title="Make knowledge accessible"
            text="Upload your first document to extract text and enable evidence retrieval."
          />
        ) : (
          <div className="document-grid">
            {rows.map((d) => (
              <article className="document-card" key={d.id}>
                <div>
                  <span className="document-icon">
                    <FileText size={25} />
                  </span>
                  <Badge value={d.status}>
                    {d.status === "needs_ocr" ? "No text layer" : d.status}
                  </Badge>
                </div>
                <h3 title={d.name}>{d.name}</h3>
                <p>{mines.find((m) => m.id === d.mine_id)?.name}</p>
                <small>
                  {(d.size / 1024).toFixed(1)} KB <span>·</span>{" "}
                  {dateLabel(d.created_at)}
                </small>
                <div className="doc-card-footer">
                  <button
                    className="text-button"
                    onClick={() => setSelected(d)}
                  >
                    Extracted text <ScanText size={14} />
                  </button>
                  <a
                    className="icon-button"
                    href={`/api/documents/${d.id}/download`}
                    onClick={(event) => {
                      event.preventDefault();
                      void downloadFile(`/documents/${d.id}/download`, d.name);
                    }}
                    aria-label={`Download ${d.name}`}
                  >
                    <Download size={16} />
                  </a>
                </div>
                {["failed", "needs_ocr"].includes(d.status) && write && (
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await post(`/documents/${d.id}/retry`, {});
                        refresh();
                        toast("Extraction restarted.");
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    <RotateCw size={13} /> Retry extraction
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <div className="subtle-note">
        <ScanText size={17} />
        <p>
          Text-based PDFs are extracted directly. Images use bundled English OCR
          with no external language-data download. Scanned PDFs without a text
          layer are marked for OCR; upload individual page images for
          recognition. Review extracted text before relying on it.
        </p>
      </div>
      {selected && (
        <Modal
          title={selected.name}
          subtitle={`Document ID: ${selected.id}`}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="detail-content">
            <div className="detail-badges">
              <Badge value={selected.status} />
              <button
                className="text-button"
                onClick={() =>
                  navigator.clipboard
                    .writeText(selected.id)
                    .then(() => toast("Document ID copied."))
                    .catch(() =>
                      toast(
                        "Clipboard unavailable. Select and copy the ID above.",
                      ),
                    )
                }
              >
                <Copy size={14} /> Copy evidence ID
              </button>
            </div>
            {selected.text ? (
              <pre className="extracted-text">{selected.text}</pre>
            ) : (
              <Empty
                title={
                  selected.status === "processing"
                    ? "Extraction in progress"
                    : "No extracted text available"
                }
                text="Close this panel and refresh after processing. For scanned PDFs, upload page images."
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
