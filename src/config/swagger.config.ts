import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Omar Derkaoui — Portfolio API')
    .setDescription(
      `
## Overview

REST API powering Omar's portfolio backend. It exposes two main surfaces:

| Tag | Endpoint | Purpose |
|-----|----------|---------|
| **query** | \`POST /api/query\` | RAG pipeline — answers questions about Omar's portfolio with cited sources |
| **chat** | \`POST /api/chat\` | Streaming chat powered by Anthropic Claude |

---

### RAG Pipeline (query)

1. **Rewrite** — the question is semantically expanded for better retrieval
2. **Embed** — the rewritten query is vectorised
3. **Retrieve** — top-k chunks are pulled from Qdrant
4. **Rerank** — Cohere reranks the candidates
5. **Generate** — Claude composes a grounded answer with sources

### Streaming Chat (chat)

Sends a multi-turn message array to Claude and streams back the response as \`text/plain\` chunks using server-sent raw HTTP streaming (no SSE envelope).

---

### Rate Limiting

Both endpoints are protected by a sliding-window rate limiter backed by Redis.
Exceeding the limit returns **429 Too Many Requests**.

### Request Tracing

Every request is assigned a UUID trace ID returned in the \`X-Request-ID\` response header.
Pass \`X-Request-ID\` in your request to propagate your own trace ID end-to-end.
      `.trim(),
    )
    .setVersion('1.0.0')
    .setContact('Omar Derkaoui', '', 'omarderkaoui1337@gmail.com')
    .setLicense('MIT', '')
    .addTag('query', 'RAG-powered Q&A about Omar\'s portfolio — returns grounded answers with cited sources')
    .addTag('chat', 'Streaming conversational AI powered by Anthropic Claude')
    .addTag('health', 'Service health and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Portfolio API — Docs',
    customCss: `
      /* ── Brand colours ─────────────────────────────────────────── */
      :root {
        --primary:    #6366f1;   /* indigo-500  */
        --primary-dk: #4f46e5;   /* indigo-600  */
        --surface:    #0f172a;   /* slate-900   */
        --surface-2:  #1e293b;   /* slate-800   */
        --surface-3:  #334155;   /* slate-700   */
        --text:       #f1f5f9;   /* slate-100   */
        --text-muted: #94a3b8;   /* slate-400   */
        --success:    #22c55e;   /* green-500   */
        --warning:    #f59e0b;   /* amber-500   */
        --danger:     #ef4444;   /* red-500     */
        --border:     #334155;
      }

      /* ── Global ─────────────────────────────────────────────────── */
      body { background: var(--surface) !important; color: var(--text) !important; font-family: 'Inter', 'Segoe UI', system-ui, sans-serif !important; }

      /* ── Top bar ─────────────────────────────────────────────────── */
      .swagger-ui .topbar { background: var(--surface-2) !important; border-bottom: 1px solid var(--border) !important; padding: 10px 0 !important; }
      .swagger-ui .topbar-wrapper .link span { display: none; }
      .swagger-ui .topbar-wrapper .link::after { content: 'Portfolio API'; color: var(--text) !important; font-size: 1.15rem; font-weight: 700; letter-spacing: -.02em; }

      /* ── Info block ──────────────────────────────────────────────── */
      .swagger-ui .info { margin: 32px 0 24px !important; }
      .swagger-ui .info .title { color: var(--text) !important; font-size: 2rem !important; font-weight: 800 !important; }
      .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info td { color: var(--text-muted) !important; }
      .swagger-ui .info a { color: var(--primary) !important; }
      .swagger-ui .info table { border-collapse: collapse; width: 100%; margin: 12px 0; }
      .swagger-ui .info th { color: var(--text) !important; background: var(--surface-3) !important; padding: 6px 12px; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; }
      .swagger-ui .info td { padding: 6px 12px; border-top: 1px solid var(--border); }
      .swagger-ui .info code { background: var(--surface-3) !important; color: var(--primary) !important; border-radius: 4px; padding: 1px 5px; font-size: .85em; }

      /* ── Wrapper & sections ──────────────────────────────────────── */
      .swagger-ui, .swagger-ui .wrapper { background: var(--surface) !important; }
      .swagger-ui .scheme-container { background: var(--surface-2) !important; box-shadow: none !important; border: 1px solid var(--border) !important; border-radius: 8px !important; padding: 12px 20px !important; }

      /* ── Tag headings ────────────────────────────────────────────── */
      .swagger-ui .opblock-tag { border-bottom: 1px solid var(--border) !important; color: var(--text) !important; font-size: 1.1rem !important; font-weight: 700 !important; padding: 14px 0 !important; }
      .swagger-ui .opblock-tag:hover { background: transparent !important; }
      .swagger-ui .opblock-tag small { color: var(--text-muted) !important; font-weight: 400; font-size: .85rem; }

      /* ── Operation blocks ────────────────────────────────────────── */
      .swagger-ui .opblock { border-radius: 8px !important; border: 1px solid var(--border) !important; box-shadow: none !important; margin: 8px 0 !important; overflow: hidden; }
      .swagger-ui .opblock.opblock-post { background: rgba(99,102,241,.08) !important; border-color: rgba(99,102,241,.3) !important; }
      .swagger-ui .opblock.opblock-post .opblock-summary-method { background: var(--primary) !important; }
      .swagger-ui .opblock.opblock-get .opblock-summary-method  { background: var(--success) !important; }

      /* summary bar */
      .swagger-ui .opblock-summary { background: transparent !important; padding: 12px 16px !important; }
      .swagger-ui .opblock-summary-method { border-radius: 4px !important; font-size: .75rem !important; font-weight: 700 !important; min-width: 68px !important; padding: 5px 0 !important; text-align: center !important; }
      .swagger-ui .opblock-summary-path { color: var(--text) !important; font-size: .95rem !important; font-weight: 600 !important; }
      .swagger-ui .opblock-summary-description { color: var(--text-muted) !important; font-size: .85rem !important; }

      /* expanded body */
      .swagger-ui .opblock-body, .swagger-ui .opblock-section { background: var(--surface-2) !important; }
      .swagger-ui .opblock-description-wrapper p { color: var(--text-muted) !important; }
      .swagger-ui .opblock-section-header { background: var(--surface-3) !important; border-bottom: 1px solid var(--border) !important; }
      .swagger-ui .opblock-section-header h4, .swagger-ui .opblock-section-header label { color: var(--text) !important; }

      /* ── Models / schemas ────────────────────────────────────────── */
      .swagger-ui section.models { border: 1px solid var(--border) !important; border-radius: 8px !important; }
      .swagger-ui section.models h4 { color: var(--text) !important; }
      .swagger-ui .model-box { background: var(--surface-2) !important; border-radius: 6px !important; }
      .swagger-ui .model { color: var(--text-muted) !important; }
      .swagger-ui .prop-type { color: var(--primary) !important; }
      .swagger-ui .prop-format { color: var(--text-muted) !important; }
      .swagger-ui table.model tr.property-row td { color: var(--text-muted) !important; border-color: var(--border) !important; }

      /* ── Parameters & responses ──────────────────────────────────── */
      .swagger-ui .parameters-container, .swagger-ui .responses-inner { background: var(--surface-2) !important; }
      .swagger-ui .parameter__name, .swagger-ui .parameter__type { color: var(--text) !important; }
      .swagger-ui .parameter__in { color: var(--text-muted) !important; font-style: italic; }
      .swagger-ui .response-col_status { color: var(--text) !important; font-weight: 600; }
      .swagger-ui .response-col_description { color: var(--text-muted) !important; }
      .swagger-ui .response-col_links { color: var(--text-muted) !important; }

      /* ── Inputs ──────────────────────────────────────────────────── */
      .swagger-ui input[type=text], .swagger-ui textarea, .swagger-ui select {
        background: var(--surface-3) !important; border: 1px solid var(--border) !important;
        border-radius: 6px !important; color: var(--text) !important; font-size: .9rem !important;
      }
      .swagger-ui input[type=text]:focus, .swagger-ui textarea:focus { border-color: var(--primary) !important; outline: none !important; }

      /* ── Buttons ─────────────────────────────────────────────────── */
      .swagger-ui .btn.execute { background: var(--primary) !important; border-color: var(--primary) !important; border-radius: 6px !important; font-weight: 600 !important; }
      .swagger-ui .btn.execute:hover { background: var(--primary-dk) !important; border-color: var(--primary-dk) !important; }
      .swagger-ui .btn.cancel  { background: transparent !important; border-color: var(--border) !important; border-radius: 6px !important; color: var(--text-muted) !important; }
      .swagger-ui .btn.btn-clear { background: transparent !important; border-color: var(--danger) !important; color: var(--danger) !important; border-radius: 6px !important; }

      /* ── Code / pre blocks ───────────────────────────────────────── */
      .swagger-ui .highlight-code, .swagger-ui .microlight { background: #0d1117 !important; border-radius: 6px !important; padding: 12px !important; }
      .swagger-ui .microlight span { color: #e2e8f0 !important; }

      /* ── Tabs ────────────────────────────────────────────────────── */
      .swagger-ui .tab li { color: var(--text-muted) !important; }
      .swagger-ui .tab li.active { color: var(--text) !important; border-bottom: 2px solid var(--primary) !important; }

      /* ── Status badges in responses ──────────────────────────────── */
      .swagger-ui .responses-table .response .response-col_status { font-size: .9rem; }

      /* ── Arrow / chevron icons ───────────────────────────────────── */
      .swagger-ui .expand-methods svg, .swagger-ui .expand-operation svg { fill: var(--text-muted) !important; }

      /* ── Scrollbar ───────────────────────────────────────────────── */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: var(--surface); }
      ::-webkit-scrollbar-thumb { background: var(--surface-3); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      tryItOutEnabled: true,
      syntaxHighlight: { activate: true, theme: 'monokai' },
    },
  });
}
