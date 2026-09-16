/* Pauseable clock for unchanged upstream timeout/interval call sites. */
(function (root) {
  class PvZClock {
    constructor() {
      this.time = 0;
      this.nextId = 0;
      this.jobs = new Map();
      this.paused = false;
    }
    timeout(fn, delay = 0, ...args) {
      return this.add(fn, delay, 0, args);
    }
    interval(fn, delay = 0, ...args) {
      return this.add(fn, delay, Math.max(1, delay), args);
    }
    add(fn, delay, period, args) {
      const id = ++this.nextId;
      this.jobs.set(id, {
        fn,
        args,
        period,
        due: this.time + Math.max(1, delay),
      });
      return id;
    }
    coalesce(id) {
      const job = this.jobs.get(id);
      if (job) job.coalesce = true;
    }
    cancel(id) {
      this.jobs.delete(id);
    }
    clear() {
      this.jobs.clear();
      this.time = 0;
    }
    tick(delta) {
      if (this.paused) return;
      this.time += Math.max(0, Math.min(delta, 100));
      for (const [id, job] of [...this.jobs]) {
        if (!this.jobs.has(id)) continue;
        let calls = 0;
        while (
          this.jobs.has(id) &&
          job.due <= this.time &&
          calls++ < 10 &&
          !this.paused
        ) {
          if (job.period) job.due = job.coalesce ? job.due + (Math.floor((this.time - job.due) / job.period) + 1) * job.period : job.due + job.period;
          else this.jobs.delete(id);
          job.fn(...job.args);
        }
      }
    }
  }
  if (typeof module !== "undefined" && module.exports)
    module.exports = { PvZClock };
  else root.PvZClock = PvZClock;
})(typeof window === "undefined" ? globalThis : window);
