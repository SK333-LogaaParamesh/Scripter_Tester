# TestGen - AI Test Studio

Give it a piece of code. An AI reads it and hands back a ready-made list of **test cases**
(checks a tester would run), **edge cases** (the tricky situations most likely to break it),
and **risks** (problems it spotted in the code). Every run is saved to a log automatically.

---

## For everyone: getting started (about 3 minutes)

1. **Unzip** the folder anywhere (e.g. your Desktop).
2. **Double-click `setup-and-run.bat`.**
   - If it says Node.js is missing, let it install, then close the window and double-click the file again.
   - When asked, paste your **API key** (see below) and press Enter. You only do this once.
3. Your browser opens at **http://localhost:3000**. That's the dashboard.

Next time, just double-click `setup-and-run.bat` again. Close the black window to stop the dashboard.

### What is an API key?
A password that lets the dashboard use an AI service. You need one from either provider:
- **OpenRouter** (easiest, many models): https://openrouter.ai/keys
- **Grok / xAI**: https://console.x.ai

Your key is saved only on your computer, in a file called `.env`. Don't share that file.

### Using the dashboard
1. **Script** - give it the code in any of three ways:
   - **Paste** the code, or
   - **Upload** a file (drag and drop), or
   - **File path** - type where the file is, e.g. `C:\Users\you\Desktop\login.py`, then click Load.
   Not sure? Try `sample_script.py` from the `samples` folder.
2. **Model** - pick Grok or OpenRouter. The default model is fine; leave "API key" blank (it uses the saved one).
3. **Focus** - leave everything ticked for a full result, or untick areas you don't care about.
   Tick *"Also generate runnable test code"* if you want code developers can run.
4. Click **Generate test cases** and wait 30-120 seconds.
5. Read the results: click any test-case row to see its steps and expected result.
   Use the search box and filters. Download as **Excel-friendly CSV**, **Markdown** or **JSON**.
6. The **History & Logs** tab lists every past run (time, script, model, counts). Click **Open** to view one again.

### Reading the results
| Word | Meaning |
|---|---|
| Test case | A check: do this, expect that |
| Edge case | An unusual input likely to break things (empty value, huge number, wrong type...) |
| Risk | Something in the code that looks like a bug or weak spot |
| Priority | High = test first, Low = nice to have |

### Something not working?
| Message | Fix |
|---|---|
| "No API key for ..." | Re-run `setup-and-run.bat` after deleting the `.env` file, or paste a key in the API key box |
| "API error 401" | The key is wrong or expired - get a new one |
| "API error 402/429" | Out of credit or rate-limited - top up the account or wait |
| "Model did not return valid JSON" | Pick a stronger model (e.g. `x-ai/grok-4`) and try again |
| "Path not found" | Check the path, or use Upload instead |
| Page won't open | Make sure the black window is still open; then visit http://localhost:3000 |

Your code is sent to the AI provider you choose (xAI or OpenRouter). Don't submit code you're not allowed to share externally.

---

## For technical readers

**Stack:** a single zero-dependency Node.js (18+) server (`src/server.js`) plus a static page (`public/index.html`). No `npm install`.
It listens on `127.0.0.1:3000` only (`PORT` env var to change).

### Project layout
```
TestGen/
  setup-and-run.bat     one-click setup + start (installs Node via winget if needed, writes .env)
  make-share-zip.bat    builds TestGen-Dashboard.zip WITHOUT .env and logs
  README.md
  .env.example          key names: XAI_API_KEY, OPENROUTER_API_KEY
  src/server.js         API, prompts, LLM calls, logging
  public/               UI: index.html (markup), style.css, app.js (vanilla JS, no build step)
  samples/              sample_script.py - demo input with deliberate weaknesses
  logs/                 one JSON file per run + testgen.log (created at runtime)
  legacy-cli/           the earlier Python command-line version (not needed by the dashboard)
```

### API
| Route | Description |
|---|---|
| `GET /api/config` | Providers, models, whether a key is configured |
| `POST /api/read-path` `{path}` | Reads a file (<=1 MB) or lists scripts in a folder |
| `POST /api/generate` | `{code,name,path,provider,model,apiKey?,temperature,framework,categories[],extra,withCode}` |
| `GET /api/logs`, `GET/DELETE /api/logs/:id` | List / open / delete runs |
| `GET /api/logs.txt` | Plain-text run log |

### Logs (`logs/`)
- `<timestamp>-<id>.json` - full record: timestamp, script name/path/lines/SHA-256, provider, model, settings, token usage, duration, the script, and results.
- `testgen.log` - one summary line per run. API keys are never logged.

### How the output is tuned ("fine-tuning" = prompt tuning; no weights are trained)
- System prompt: senior QA/SDET persona using equivalence partitioning, boundary analysis and error guessing; forbids inventing APIs not in the code.
- Strict JSON schema + one few-shot example; `response_format: json_object` (auto-falls back if the model rejects it).
- Low default temperature (0.2), per-category focus, framework hint, free-text instructions.
- Scripts over ~24k chars are chunked and merged; invalid JSON gets one automatic repair retry.
- Optional second call generates a runnable test file for the chosen framework.

To change behaviour, edit `SYSTEM_PROMPT`, `CATEGORIES` and `PROVIDERS` at the top of `src/server.js`.
Adding another OpenAI-compatible provider = one new entry in `PROVIDERS`.

### Sharing
Run `make-share-zip.bat` and send the zip. Each person supplies their own key on first run.
Do not bind the server to `0.0.0.0` on a shared network without adding authentication - it would expose the stored keys' usage.
