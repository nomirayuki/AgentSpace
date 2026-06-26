<div align="center">

# NomiraYuki — YUKI Agent

**Autonomous engineering & market-intelligence agent runtime.**
Model-agnostic brain · hybrid memory · knowledge governance · native tool-calling.

</div>

## Apa ini

YUKI adalah _runtime_ agent otonom yang menerapkan prinsip: **keandalan dulu, bukti
sebelum asumsi, verifikasi sebelum menyimpulkan, dan belajar dari pengalaman
terverifikasi**. Runtime-nya **model-agnostic** — "otak" (LLM) bisa diganti tanpa
mengubah kode: `MockBrain` (offline), Claude (Anthropic), atau model fine-tune
self-hosted lewat endpoint OpenAI-compatible.

## Kemampuan inti

| Komponen             | Berkas                        | Fungsi                                                               |
| -------------------- | ----------------------------- | -------------------------------------------------------------------- |
| Brain pluggable      | `src/yuki/llm.ts`, `brain.ts` | MockBrain / Anthropic / OpenAI-compatible + native tool-calling      |
| Hybrid memory        | `src/yuki/memory.ts`          | working / semantic (retrieval) / consolidated, dengan isolasi domain |
| Knowledge governance | `src/yuki/knowledge.ts`       | `validate → confidence → store`, promosi/demosi, resolusi konflik    |
| Confidence           | `src/yuki/confidence.ts`      | band 0–39 … 90–100                                                   |
| Reasoning            | `src/yuki/reasoning.ts`       | jejak penalaran 7 langkah + klasifikasi domain                       |
| Tools                | `src/yuki/tools.ts`           | function-calling tervalidasi zod + JSON Schema                       |
| Orchestrator         | `src/yuki/agent.ts`           | loop: retrieve → reason → tool → answer → learn                      |

## Endpoint HTTP

| Method | Path                                  | Fungsi                                                  |
| ------ | ------------------------------------- | ------------------------------------------------------- |
| `GET`  | `/health`                             | health check                                            |
| `POST` | `/yuki/ask`                           | jalankan tugas (jawaban + jejak penalaran + confidence) |
| `POST` | `/yuki/learn`                         | catat pengalaman terverifikasi jadi pengetahuan         |
| `GET`  | `/yuki/knowledge`                     | inspeksi pengetahuan (opsional `?domain=`)              |
| `POST` | `/score`                              | skor tag via plugin WASM (Rust)                         |
| `POST` | `/agents`, `GET /agents`, `POST /run` | registry & selektor agent                               |

## Jalankan

```bash
npm install
npm run build && npm start        # produksi
npm run dev                       # mode dev (tsx)
npm test                          # 49 test
```

### Memilih otak (via environment)

```bash
# Claude (rekomendasi untuk langsung "hidup")
export ANTHROPIC_API_KEY=sk-...
export ANTHROPIC_MODEL=claude-opus-4-6

# atau model fine-tune self-hosted (OpenAI-compatible: vLLM/TGI/Ollama)
export LLM_BASE_URL=http://localhost:8000
export LLM_MODEL=yuki-sft

# tanpa env apa pun -> MockBrain (offline, untuk dev/test)
```

## Otak & fine-tuning

YUKI bisa di-fine-tune dengan 5 dataset (reasoning, SWE-bench, ToolACE, xLAM,
OpenHands). Pipeline + resep ada di [`training/`](training/) dan arsitekturnya di
[`docs/YUKI_BRAIN.md`](docs/YUKI_BRAIN.md). _Catatan: training butuh GPU dan
dijalankan di infrastruktur terpisah, bukan di repo ini._

## Roadmap

1. **Fase 1 — hidupkan otak**: colok Claude via `ANTHROPIC_API_KEY` (siap, tanpa ubah kode).
2. **Fase 2 — persistensi & deploy**: simpan memory/knowledge (SQLite/Supabase) + container.
3. **Fase 3 — fine-tune**: bikin otak khusus murah & spesifik dari `training/`.

## Lisensi

MIT
