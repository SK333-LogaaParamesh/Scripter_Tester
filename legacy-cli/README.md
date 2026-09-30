# testgen - LLM test case generator

Point it at your automation/QA scripts and it writes readable test cases for you
(one Markdown file per script + one Excel sheet with everything).

## Quick start (3 steps)
1. **Install Python** (3.9+) and, for a local LLM, [Ollama](https://ollama.com) then run `ollama pull llama3.1`.
   Or get a free/paid key at https://openrouter.ai to use a cloud model.
2. **Double-click `run.bat`** (it installs the needed packages the first time).
3. **Answer the questions:**
   ```
   1. Path to your script or folder: D:\my_scripts\login_test.py
   2. Which LLM? (1 = Ollama local, 2 = OpenRouter cloud) [1]:
   3. Model name [llama3.1]:
   ```
   When it finishes, the output folder opens automatically.

Prefer the command line? Skip the questions:

    python generate_tests.py --input "D:\my_scripts\login_test.py" --provider ollama --model llama3.1
    set OPENROUTER_API_KEY=sk-or-...
    python generate_tests.py --input "D:\my_scripts" --provider openrouter --model openai/gpt-4o-mini

| Option | Meaning | Default |
|---|---|---|
| `--input` | script file or folder | asks you |
| `--provider` | `ollama` or `openrouter` | `ollama` |
| `--model` | model name | provider's default |
| `--output` | where results go | `output` |

## What you get (in the `output` folder)
- `test_cases.xlsx` - all test cases in one filterable sheet (best for sharing with your TL)
- `<script>_testcases.md` - readable version: summary table + each case with steps and expected result
- `<script>_testcases.json` - raw data

## How it works (in plain words)
1. It reads your script(s). Supported: `.py .js .ts .java .robot .cs .rb .ps1 .sh`.
2. It sends the code to an LLM and asks: "act as a senior QA engineer and list test cases".
3. The LLM answers in a fixed format, which the tool checks (and retries if it is broken).
4. The tool turns the answer into the Markdown and Excel files.

## Technique used
**LLM-based test generation via prompt engineering** (no training or fine-tuning):

1. **Role prompting**: the model is told to act as a senior QA engineer, which steers it toward test-design thinking (positive, negative and edge cases).
2. **Zero-shot, structured output**: the script's source code is put in the prompt and the model must reply with a strict JSON array (`id, title, type, priority, preconditions, steps, expected_result`). A fixed schema makes the output machine-readable, so the same data becomes Markdown and Excel.
3. **Low temperature (0.2)**: keeps output focused and repeatable instead of creative.
4. **Provider abstraction**: OpenRouter (cloud) and Ollama (local) both expose an OpenAI-compatible `/chat/completions` API, so one HTTP client serves both.
5. **Chunking**: scripts larger than ~12,000 characters are split on line boundaries to fit the model's context window; results are merged and renumbered (TC-001, TC-002, ...).
6. **Validate and retry**: the reply is stripped of markdown fences and parsed as JSON (regex fallback), retried up to 3 times if malformed.
7. **Post-processing**: parsed cases are written to Markdown/JSON per script and one formatted Excel sheet.

Limitations: the model only sees the script text, so review the generated cases for accuracy. Small local models may give weaker or malformed output.

## Troubleshooting
- `cannot reach http://localhost:11434` - Ollama isn't running; start it.
- `set OPENROUTER_API_KEY` - you chose OpenRouter without a key; paste it when asked.
- `path not found` - check the path (put quotes around paths with spaces).
- `no valid JSON` - the model gave a bad reply; try a larger model.
