export interface StorePort {
  read(path: string, offset?: number, limit?: number): Promise<string>;
  write(path: string, content: string): Promise<void>;
  edit(path: string, oldStr: string, newStr: string): Promise<number>;
  list(path: string): Promise<string[]>;
}
