// Group consecutive typing events only while they are already waiting behind
// an earlier disk operation. Starting a save, read or tab switch seals a group.
class JournalAppendQueue {
  constructor(schedule, append) {
    this.schedule = schedule;
    this.write = append;
    this.pending = null;
  }
  barrier() { this.pending = null; }
  append(projectId, events) {
    const event = Array.isArray(events) && events.length === 1 ? events[0] : null;
    let record;
    if (Number.isSafeInteger(event?.sequence) && event.sequence > 0) {
      // Stop measuring immediately on a large paste, image or document-wide
      // edit. Serializing its full contents here would delay incoming IPC.
      let remaining = 64 * 1024;
      try {
        record = JSON.stringify(event, (key, value) => {
          remaining -= key.length + (typeof value === 'string' ? value.length : 1);
          if (remaining < 0) throw new RangeError('Large editing history record');
          return value;
        });
      } catch { /* Let the journal handle large or non-serializable records. */ }
    }
    // Bulk recovery, unusually large edits and malformed requests retain their
    // own transaction. IPC already transferred ownership of their argument.
    if (!record || record.length > 64 * 1024) return this.schedule(() => this.write(projectId, events));
    let group = this.pending;
    if (!group || group.projectId !== projectId || group.last + 1 !== event.sequence ||
        group.records.length >= 128 || group.characters + record.length > 256 * 1024) {
      group = { projectId, records: [], characters: 0 };
      group.done = this.schedule(() => this.flush(group));
      this.pending = group;
    }
    const position = group.records.length;
    group.records.push(record);
    group.characters += record.length;
    group.last = event.sequence;
    return group.done.then(outcomes => {
      const outcome = outcomes[position];
      if (outcome.error) throw outcome.error;
      return outcome.value;
    });
  }
  async flush(group) {
    if (this.pending === group) this.pending = null;
    const events = group.records.map(record => JSON.parse(record));
    if (events.length === 1) return [{ value: await this.write(group.projectId, events) }];
    // Only group fresh additions. Retried, conflicting and overlapping
    // appends must see the exact journal state at each original call boundary.
    const result = await this.write(group.projectId, events, events[0].sequence - 1);
    if (result) return events.map(event => ({ value: { sequence: event.sequence } }));
    const outcomes = [];
    for (const event of events) {
      try { outcomes.push({ value: await this.write(group.projectId, [event]) }); }
      catch (error) { outcomes.push({ error }); }
    }
    return outcomes;
  }
}

module.exports = { JournalAppendQueue };
