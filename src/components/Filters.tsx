// SPEC §7.3: the four filters, as native selects with their labels.

import { ISSUE_TYPES, type Filters as FilterValues } from "../lib/decisions";
import { SOURCE_LABEL, TYPE_LABEL } from "../lib/describe";

interface FiltersProps {
  filters: FilterValues;
  onChange: (filters: FilterValues) => void;
}

type Options = Array<{ value: string; label: string }>;

const FIELDS: Array<{ key: keyof FilterValues; label: string; options: Options }> = [
  {
    key: "type",
    label: "Type",
    options: [
      { value: "all", label: "All types" },
      ...ISSUE_TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] })),
    ],
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "all", label: "All statuses" },
      { value: "pending", label: "Pending" },
      { value: "accepted", label: "Accepted or confirmed" },
      { value: "rejected", label: "Rejected or dismissed" },
    ],
  },
  {
    key: "confidence",
    label: "Confidence",
    options: [
      { value: "all", label: "All levels" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
  },
  {
    key: "source",
    label: "Source",
    options: [
      { value: "all", label: "All sources" },
      { value: "rule", label: SOURCE_LABEL.rule },
      { value: "ai", label: SOURCE_LABEL.ai },
    ],
  },
];

export function Filters({ filters, onChange }: FiltersProps) {
  return (
    <form
      aria-label="Filters"
      className="flex flex-wrap items-end gap-x-4 gap-y-3"
      onSubmit={(event) => event.preventDefault()}
    >
      {FIELDS.map((field) => (
        <label key={field.key} className="flex flex-col gap-1 text-[12px] text-muted">
          {field.label}
          <select
            className="field min-w-[10.5rem]"
            value={filters[field.key]}
            // Every option value of a field is a member of that field's type.
            onChange={(event) => onChange({ ...filters, [field.key]: event.target.value } as FilterValues)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </form>
  );
}
