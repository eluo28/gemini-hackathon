export interface StreamObject {
  name: string;
  description: string;
  searchQuery: string;
  box: number[];
  evidence: string;
}
export interface StreamAnswer { answer: string; items: StreamObject[] }
