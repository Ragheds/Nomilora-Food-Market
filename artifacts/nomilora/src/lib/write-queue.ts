// Failed writes stay at the head; later edits cannot silently overwrite a failed save.
export class WriteQueue {
  private items: (() => Promise<void>)[] = [];
  private running = false;
  private disposed = false;
  error = "";
  private notify: (pending: number, error: string) => void;
  constructor(notify: (pending: number, error: string) => void) {
    this.notify = notify;
  }
  enqueue(write: () => Promise<void>) {
    this.items.push(write);
    this.publish();
    if (!this.error) void this.drain();
  }
  retry() {
    this.error = "";
    void this.drain();
  }
  dispose() {
    this.disposed = true;
    this.items = [];
  }
  private publish() {
    if (!this.disposed) this.notify(this.items.length, this.error);
  }
  private async drain() {
    if (this.running || this.disposed) return;
    this.running = true;
    this.publish();
    try {
      while (this.items.length && !this.disposed) {
        try {
          await this.items[0]();
          this.items.shift();
        } catch (error) {
          this.error =
            error instanceof Error
              ? error.message
              : "Changes could not be saved.";
          break;
        }
        this.publish();
      }
    } finally {
      this.running = false;
      this.publish();
    }
  }
}
