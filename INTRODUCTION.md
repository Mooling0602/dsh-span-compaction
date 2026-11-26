A compaction engine that keeps one summarization request inside a replay budget, and gives the model the tools to compact a range it chooses itself.

**Configuration**: the plugin's card in Plugins carries the replay budget, the two model tools and the context-pressure reminder. A save applies to the next compaction pass or the next step; no restart is needed.

**Approval**: except under Full access, the model's `compact` call waits for your approval; `compact_targets` only lists candidates and skips downstream policy, including Auto review.

**Tools**: `compact_targets` lists the ranges available for compaction with their priced tokens, and `compact` commits a range using a summary the model writes, through the native compaction transaction.

Automatic compaction stays on as an overflow safety net, and `/compact` is unchanged. The reminder only suggests compaction and never runs one. Compaction rewrites the session surface, so the summary you write is what later turns, subagents and periodic reports read.
