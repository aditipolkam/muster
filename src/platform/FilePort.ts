export interface FileWriter {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Local file access behind an interface; fakes make download logic testable without a device. */
export interface FilePort {
  /** Documents directory URI with trailing slash. */
  readonly root: string;
  exists(uri: string): Promise<boolean>;
  /** 0 when the file does not exist. */
  size(uri: string): Promise<number>;
  mkdirp(uri: string): Promise<void>;
  /** Idempotent. */
  remove(uri: string): Promise<void>;
  /** Overwrites the destination. */
  move(from: string, to: string): Promise<void>;
  readRange(uri: string, offset: number, length: number): Promise<Uint8Array>;
  readText(uri: string): Promise<string>;
  writeBytes(uri: string, bytes: Uint8Array): Promise<void>;
  openWriter(uri: string, mode: 'truncate' | 'append'): Promise<FileWriter>;
  freeBytes(): Promise<number>;
  /** Total bytes of all files under dirUri (recursive); 0 if missing. */
  dirSize(dirUri: string): Promise<number>;
  /** File and directory names (not URIs) directly under dirUri. */
  list(dirUri: string): Promise<string[]>;
}
