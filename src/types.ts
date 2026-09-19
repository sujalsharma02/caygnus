export type State = "active" | "superseded" | "deleted";

export interface Source {
  message_id: string;
  text: string;
}

/** A structured fact proposed for storage. Free-text extraction is out of scope;
 *  callers (or the fixture) supply subject/attribute/value directly. */
export interface Candidate {
  subject?: string; // default "user"
  attribute: string;
  value: string;
  source: Source;
  correction?: boolean; // undefined = infer from source text
}

export interface Memory {
  id: string;
  subject: string;
  attribute: string;
  value: string;
  text: string; // "subject attribute value. source text": the lexical retrieval surface
  source: Source;
  state: State;
  created_at: number;
  updated_at: number;
  supersedes?: string;
  superseded_by?: string;
  conflicts_with: string[];
}

export interface Hit {
  memory: Memory;
  score: number;
  matched_terms: string[];
  rule: string;
}
