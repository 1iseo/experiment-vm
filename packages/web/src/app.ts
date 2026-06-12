import * as parser from "@babel/parser";
import { instance as createViz, type Viz } from "@viz-js/viz";
import { disassembleBytecode, formatDisassembly, type DisassembledInstruction } from "@experiment-vm/vm/disassemble";
import { lowerIRProgramToBytecode, type ProgramLoweringResult } from "@experiment-vm/vm/ir_lower";
import { prettyPrintIRFunction, translateProgramToObfuscatedIR, type IRProgram } from "@experiment-vm/vm/ir_v2";
import {
	buildBlockCfg,
	debugRangeForGraphBlock,
	graphBlockIdForDebugRange,
	toDot,
	type BlockCfgGraph,
} from "./cfg_graph.js";
import {
	bestDebugRangeForOffset,
	buildLabels,
	disassemblyOffsetsForRange,
	flattenDebugRanges,
	formatBytecodeHex,
	formatConstantPool,
	type UiDebugRange,
} from "./ui_helpers.js";
import "./styles.css";

const sampleSource = `"use strict";
function fact(n) {
  if (n <= 1) {
    return 1;
  }
  return n * fact(n - 1);
}
var obj = { x: 4, f: function () { return this.x; } };
switch (fact(3)) {
  case 6:
    return obj.f();
  default:
    return 0;
}`;

type CompileOutput = {
	irProgram: IRProgram;
	lowered: ProgramLoweringResult;
	rows: DisassembledInstruction[];
	debugRanges: UiDebugRange[];
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
	throw new Error("Missing #app");
}

app.innerHTML = `
  <main class="workspace">
    <section class="source-panel">
      <div class="panel-heading">
        <div>
          <h1>VM Disassembler</h1>
          <span class="subtle">JavaScript to IR to bytecode</span>
        </div>
        <div class="controls">
          <label class="seed-label">Seed <input id="seed-input" type="number" value="1" /></label>
          <button id="compile-button" type="button">Compile</button>
        </div>
      </div>
      <textarea id="source-input" spellcheck="false"></textarea>
      <pre id="error-panel" class="error-panel" aria-live="polite"></pre>
    </section>
    <section class="output-panel">
      <div class="summary-strip">
        <div><span id="summary-functions">0</span><small>functions</small></div>
        <div><span id="summary-bytes">0</span><small>bytes</small></div>
        <div><span id="summary-constants">0</span><small>constants</small></div>
        <div><span id="summary-ranges">0</span><small>ranges</small></div>
      </div>
      <div class="inspect-grid">
        <section class="pane disassembly-pane">
          <div class="pane-title">Disassembly</div>
          <div id="disassembly-output" class="table-like"></div>
        </section>
        <section class="pane">
          <div class="pane-title pane-title-row">
            <span>Graph</span>
            <select id="graph-function-select" aria-label="Graph function"></select>
          </div>
          <div id="graph-output" class="graph-output"></div>
        </section>
        <section class="pane">
          <div class="pane-title">IR</div>
          <pre id="ir-output" class="code-block"></pre>
        </section>
        <section class="pane">
          <div class="pane-title">Constants</div>
          <div id="constants-output" class="constant-list"></div>
        </section>
        <section class="pane">
          <div class="pane-title">Debug Map</div>
          <div id="debug-output" class="debug-list"></div>
        </section>
        <section class="pane wide">
          <div class="pane-title">Bytecode</div>
          <pre id="bytecode-output" class="code-block"></pre>
        </section>
      </div>
    </section>
  </main>
`;

const sourceInput = mustGet<HTMLTextAreaElement>("source-input");
const seedInput = mustGet<HTMLInputElement>("seed-input");
const compileButton = mustGet<HTMLButtonElement>("compile-button");
const errorPanel = mustGet<HTMLPreElement>("error-panel");
const irOutput = mustGet<HTMLPreElement>("ir-output");
const disassemblyOutput = mustGet<HTMLDivElement>("disassembly-output");
const graphFunctionSelect = mustGet<HTMLSelectElement>("graph-function-select");
const graphOutput = mustGet<HTMLDivElement>("graph-output");
const constantsOutput = mustGet<HTMLDivElement>("constants-output");
const debugOutput = mustGet<HTMLDivElement>("debug-output");
const bytecodeOutput = mustGet<HTMLPreElement>("bytecode-output");
const summaryFunctions = mustGet<HTMLSpanElement>("summary-functions");
const summaryBytes = mustGet<HTMLSpanElement>("summary-bytes");
const summaryConstants = mustGet<HTMLSpanElement>("summary-constants");
const summaryRanges = mustGet<HTMLSpanElement>("summary-ranges");

sourceInput.value = sampleSource;
compileButton.addEventListener("click", () => compileAndRender());

let currentOutput: CompileOutput | undefined;
let currentGraph: BlockCfgGraph | undefined;
let selectedFunctionId = "";
let selectedGraphBlockId: string | undefined;
let graphRenderVersion = 0;
let vizPromise: Promise<Viz> | undefined;

graphFunctionSelect.addEventListener("change", () => {
	selectedFunctionId = graphFunctionSelect.value;
	selectedGraphBlockId = undefined;
	if (currentOutput) {
		void renderGraph(currentOutput);
	}
});

function mustGet<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing #${id}`);
	}
	return element as T;
}

function compileSource(source: string, seed: number): CompileOutput {
	const ast = parser.parse(source, {
		sourceType: "script",
		allowReturnOutsideFunction: true,
	});
	const irProgram = translateProgramToObfuscatedIR(ast.program, { seed });
	const lowered = lowerIRProgramToBytecode(irProgram, { seed, debug: true });
	const labels = buildLabels(lowered.debugMap);
	const rows = disassembleBytecode(lowered.bytecode, {
		constantPool: lowered.constantPool,
		labels,
	});
	return {
		irProgram,
		lowered,
		rows,
		debugRanges: flattenDebugRanges(lowered.debugMap),
	};
}

function compileAndRender(): void {
	const seed = Number.isFinite(seedInput.valueAsNumber) ? seedInput.valueAsNumber : 1;
	try {
		const output = compileSource(sourceInput.value, seed);
		errorPanel.textContent = "";
		errorPanel.classList.remove("is-visible");
		renderOutput(output);
	} catch (error) {
		errorPanel.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		errorPanel.classList.add("is-visible");
	}
}

function renderOutput(output: CompileOutput): void {
	currentOutput = output;
	const functions = Array.from(output.irProgram.functions.values());
	irOutput.textContent = functions.map(prettyPrintIRFunction).join("\n\n");
	bytecodeOutput.textContent = formatBytecodeHex(output.lowered.bytecode);
	renderGraphFunctionSelect(output.irProgram);
	void renderGraph(output);
	renderDisassembly(output.rows, output.debugRanges);
	renderConstants(output.lowered.constantPool);
	renderDebugRanges(output.debugRanges, output.rows);
	summaryFunctions.textContent = String(functions.length);
	summaryBytes.textContent = String(output.lowered.bytecode.length);
	summaryConstants.textContent = String(output.lowered.constantPool.length);
	summaryRanges.textContent = String(output.debugRanges.length);
}

function renderDisassembly(rows: DisassembledInstruction[], debugRanges: UiDebugRange[]): void {
	disassemblyOutput.replaceChildren();
	const formatted = formatDisassembly(rows, { showBytes: true }).split("\n");
	for (let i = 0; i < rows.length; i += 1) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = "disassembly-row";
		row.dataset.offset = String(rows[i].offset);
		row.textContent = formatted[i];
		row.addEventListener("click", () => {
			const range = bestDebugRangeForOffset(debugRanges, rows[i].offset);
			highlight(rows, range ? disassemblyOffsetsForRange(rows, range) : [rows[i].offset], range?.id, graphBlockForRange(range));
		});
		disassemblyOutput.append(row);
	}
}

function renderGraphFunctionSelect(irProgram: IRProgram): void {
	const functions = Array.from(irProgram.functions.values());
	const previousSelection = selectedFunctionId;
	graphFunctionSelect.replaceChildren();
	for (const fn of functions) {
		const option = document.createElement("option");
		option.value = fn.id;
		option.textContent = fn.id;
		graphFunctionSelect.append(option);
	}
	const functionIds = new Set(functions.map((fn) => fn.id));
	selectedFunctionId = functionIds.has(previousSelection)
		? previousSelection
		: functionIds.has(irProgram.entryPoint)
			? irProgram.entryPoint
			: functions[0]?.id ?? "";
	graphFunctionSelect.value = selectedFunctionId;
	graphFunctionSelect.disabled = functions.length === 0;
}

async function renderGraph(output: CompileOutput): Promise<void> {
	const renderVersion = ++graphRenderVersion;
	const fn = output.irProgram.functions.get(selectedFunctionId);
	currentGraph = undefined;
	graphOutput.replaceChildren();
	if (!fn) {
		renderGraphMessage("No function selected.");
		return;
	}

	const graph = buildBlockCfg(fn.id, fn, output.lowered.debugMap);
	currentGraph = graph;
	renderGraphMessage("Rendering graph...");

	try {
		const viz = await getViz();
		if (renderVersion !== graphRenderVersion) {
			return;
		}
		const svg = viz.renderSVGElement(toDot(graph), { engine: "dot" });
		graphOutput.replaceChildren(svg);
		wireGraphSvg(svg, graph, output);
		selectGraphBlock(selectedGraphBlockId);
	} catch (error) {
		if (renderVersion !== graphRenderVersion) {
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		renderGraphMessage(`Graph rendering failed: ${message}`);
	}
}

function getViz(): Promise<Viz> {
	vizPromise ??= createViz();
	return vizPromise;
}

function renderGraphMessage(message: string): void {
	const fallback = document.createElement("div");
	fallback.className = "graph-message";
	fallback.textContent = message;
	graphOutput.replaceChildren(fallback);
}

function wireGraphSvg(svg: SVGSVGElement, graph: BlockCfgGraph, output: CompileOutput): void {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	for (const group of svg.querySelectorAll<SVGGElement>("g.node")) {
		const title = group.querySelector("title")?.textContent;
		if (!title || !nodesById.has(title)) {
			continue;
		}
		const node = nodesById.get(title)!;
		group.dataset.blockId = node.id;
		group.setAttribute("role", "button");
		group.setAttribute("tabindex", "0");
		group.addEventListener("click", () => selectGraphNode(node.id, graph, output));
		group.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				selectGraphNode(node.id, graph, output);
			}
		});
	}
}

function selectGraphNode(blockId: string, graph: BlockCfgGraph, output: CompileOutput): void {
	const node = graph.nodes.find((candidate) => candidate.id === blockId);
	const range = debugRangeForGraphBlock(graph, output.debugRanges, blockId);
	const bytecodeRange = node?.bytecodeRange ?? range;
	highlight(
		output.rows,
		bytecodeRange ? disassemblyOffsetsForRange(output.rows, bytecodeRange) : [],
		range?.id,
		blockId,
	);
}

function renderConstants(constantPool: unknown[]): void {
	constantsOutput.replaceChildren();
	for (const entry of formatConstantPool(constantPool)) {
		const row = document.createElement("div");
		row.className = "constant-row";
		const index = document.createElement("span");
		index.className = "constant-index";
		index.textContent = `#${entry.index}`;
		const value = document.createElement("code");
		value.textContent = entry.preview;
		row.append(index, value);
		constantsOutput.append(row);
	}
}

function renderDebugRanges(ranges: UiDebugRange[], rows: DisassembledInstruction[]): void {
	debugOutput.replaceChildren();
	for (const range of ranges) {
		const row = document.createElement("button");
		row.type = "button";
		row.className = `debug-row ${range.kind}`;
		row.dataset.rangeId = range.id;
		row.addEventListener("click", () => {
			highlight(rows, disassemblyOffsetsForRange(rows, range), range.id, graphBlockForRange(range));
		});

		const title = document.createElement("span");
		title.className = "debug-title";
		title.textContent = range.label;
		const meta = document.createElement("span");
		meta.className = "debug-meta";
		meta.textContent = `${range.kind} ${range.startPc}-${range.endPc} ${range.detail}`;
		row.append(title, meta);
		debugOutput.append(row);
	}
}

function highlight(rows: DisassembledInstruction[], offsets: number[], rangeId?: string, graphBlockId?: string): void {
	const offsetSet = new Set(offsets);
	for (const row of disassemblyOutput.querySelectorAll<HTMLElement>(".disassembly-row")) {
		const offset = Number(row.dataset.offset);
		row.classList.toggle("is-active", offsetSet.has(offset));
	}
	for (const row of debugOutput.querySelectorAll<HTMLElement>(".debug-row")) {
		row.classList.toggle("is-active", row.dataset.rangeId === rangeId);
	}
	if (offsets.length === 0 && rows.length > 0) {
		const first = disassemblyOutput.querySelector<HTMLElement>(".disassembly-row");
		first?.classList.remove("is-active");
	}
	selectedGraphBlockId = graphBlockId;
	selectGraphBlock(graphBlockId);
}

function selectGraphBlock(blockId: string | undefined): void {
	for (const node of graphOutput.querySelectorAll<SVGGElement>("g.node")) {
		node.classList.toggle("is-selected", node.dataset.blockId === blockId);
	}
}

function graphBlockForRange(range: UiDebugRange | undefined): string | undefined {
	return currentGraph ? graphBlockIdForDebugRange(currentGraph, range) : undefined;
}

compileAndRender();
