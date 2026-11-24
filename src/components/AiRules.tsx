// SPEC §7.3 and §6.3: the "AI rules" panel. The rules the model proposed for this file that
// the data supports, each with the numbers behind it, and the rejected rules with the reason.

import { useState } from "react";
import type { VerifiedContract } from "../core/types";

interface Rule {
  title: string;
  /** The model's reason, where the rule has one. */
  reason?: string;
  /** The numbers from the file that support the rule. */
  support?: string;
}

/** The names of `VerifiedContract.rejected[].rule`, in words. */
const REJECTED_KIND: Record<string, string> = {
  column: "Column",
  format: "Format",
  missingToken: 'Value that means "no value"',
  canonicalGroup: "Same value, written differently",
  suspiciousValue: "Test or junk value",
  range: "Usual range",
  dependency: "One column decides another",
};

/** SPEC §5.5: C5 is cut, so a format that passed its check produces no issue. */
export const FORMATS_KIND = "Formats: checked against the file, not used to find issues in this version";

/** A rejected dependency in the words of a verified one. The core writes it as "a -> b". */
const rejectedSummary = (rule: VerifiedContract["rejected"][number]) =>
  rule.rule === "dependency" ? rule.summary.replace(" -> ", " decides ") : rule.summary;

const quoted = (values: string[]) => values.map((value) => `"${value}"`).join(", ");

function verifiedRules(contract: VerifiedContract): Array<{ kind: string; rules: Rule[] }> {
  return [
    {
      kind: 'Values that mean "no value"',
      rules: contract.missingTokens.map((rule) => ({ title: `${rule.column}: "${rule.token}"`, support: rule.support })),
    },
    {
      kind: "Same value, written differently",
      rules: contract.canonicalGroups.map((rule) => ({
        title: `${rule.column}: ${quoted(rule.variants)} → "${rule.canonical}"`,
        reason: rule.reason,
        support: rule.support,
      })),
    },
    {
      kind: "Test or junk values",
      rules: contract.suspiciousValues.map((rule) => ({
        title: `${rule.column}: "${rule.value}"`,
        reason: rule.reason,
        support: rule.support,
      })),
    },
    {
      kind: "Usual ranges",
      rules: contract.ranges.map((rule) => ({
        title: `${rule.column}: ${rule.min || "no lower bound"} to ${rule.max || "no upper bound"}`,
        reason: rule.reason,
        support: rule.support,
      })),
    },
    {
      kind: "One column decides another",
      rules: contract.dependencies.map((rule) => ({
        title: `${rule.determinant} decides ${rule.dependent}`,
        reason: rule.reason,
        support: rule.support,
      })),
    },
    {
      kind: FORMATS_KIND,
      rules: contract.columns
        .filter((column) => column.format !== "none")
        .map((column) => ({ title: `${column.name}: ${column.format}` })),
    },
  ].filter((section) => section.rules.length > 0);
}

export function AiRules({ contract }: { contract: VerifiedContract }) {
  const sections = verifiedRules(contract);
  const verified = sections.reduce((sum, section) => sum + section.rules.length, 0);
  const rejected = contract.rejected.length;
  // Collapsed by default, like a group of issues: the counts are enough until the user asks.
  const [open, setOpen] = useState(false);

  return (
    // What the model proposed: the edge of the panel and the rules in it are in its colour.
    <section
      aria-labelledby="ai-rules-title"
      className="mt-6 border border-grid border-l-[3px] border-l-model bg-sheet px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="ai-rules-title" className="text-title font-semibold">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? "ai-rules-content" : undefined}
            onClick={() => setOpen(!open)}
            className="-mx-1 inline-flex cursor-pointer items-baseline gap-2.5 rounded-control px-1 text-left hover:underline"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-4 shrink-0 items-center justify-center self-center border border-edge bg-sheet text-note leading-none font-bold"
            >
              {open ? "\u2212" : "+"}
            </span>
            AI rules
          </button>
        </h2>
        <p className="text-note text-muted">
          <b className="text-ink">{verified}</b> verified against the file, <b className="text-ink">{rejected}</b>{" "}
          rejected
        </p>
      </div>
      {open && <Rules contract={contract} />}
    </section>
  );
}

function Rules({ contract }: { contract: VerifiedContract }) {
  const sections = verifiedRules(contract);
  const verified = sections.reduce((sum, section) => sum + section.rules.length, 0);
  const rejected = contract.rejected.length;

  return (
    <div id="ai-rules-content" className="pl-[1.625rem]">
      <p className="mt-3 max-w-[75ch] text-muted">
        The AI proposed these rules about the file. Code checked each one against the data, and the numbers under a
        rule are what the file shows. A rule the data does not support is rejected and produces no issue. A verified
        rule is used to find issues, except a format: this version checks formats and does not use them.
      </p>

      <h3 className="mt-5 text-note font-semibold">
        Verified rules <span className="font-normal">({verified})</span>
      </h3>
      {verified === 0 && <p className="mt-1 text-muted">The data supports none of the proposed rules.</p>}
      {sections.map((section) => (
        <div key={section.kind} className="mt-3">
          <h4 className="text-note text-muted">{section.kind}</h4>
          <ul>
            {section.rules.map((rule) => (
              <li key={rule.title} className="border-t border-grid py-2">
                <p className="file text-note font-semibold text-model [overflow-wrap:anywhere]">{rule.title}</p>
                {rule.reason !== undefined && <p className="max-w-[75ch] text-model">{rule.reason}</p>}
                {rule.support !== undefined && <p className="max-w-[75ch] text-note text-muted">{rule.support}</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <h3 className="mt-6 text-note font-semibold">
        Rejected rules <span className="font-normal">({rejected})</span>
      </h3>
      {rejected === 0 ? (
        <p className="mt-1 max-w-[75ch] text-muted">
          No rule was rejected: the data supports every rule the AI proposed for this file.
        </p>
      ) : (
        <ul className="mt-1">
          {contract.rejected.map((rule, position) => (
            <li key={position} className="border-t border-grid py-2">
              <p className="text-note text-muted">{REJECTED_KIND[rule.rule] ?? rule.rule}</p>
              <p className="file text-note font-semibold text-model [overflow-wrap:anywhere]">{rejectedSummary(rule)}</p>
              <p className="max-w-[75ch]">Rejected: {rule.reason}.</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
