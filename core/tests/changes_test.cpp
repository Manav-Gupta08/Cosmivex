#include "universe/changes.hpp"
#include "universe/model.hpp"
#include <chrono>
#include <iostream>
#include <stdexcept>

void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

universe::ProcessRow process(uint32_t pid, uint64_t generation) {
    universe::ProcessRow row;
    row.generation = generation;
    row.observation.pid = pid;
    row.observation.name = "fixture.exe";
    row.observation.creation_filetime = generation * 100;
    row.observation.executable_path = "C:\\fixture.exe";
    return row;
}

universe::ProcessSnapshot snapshot(uint64_t time, std::vector<universe::ProcessRow> rows) {
    universe::ProcessSnapshot result;
    result.observed_at_unix_ms = time;
    result.processes = std::move(rows);
    result.universe = std::make_shared<universe::UniverseModel>(universe::build_universe(result));
    return result;
}

int main() {
    try {
        universe::EventJournal journal;
        auto first = snapshot(1000, {process(10, 1)});
        auto events = journal.observe(first, 100);
        check(events->events.size() == 1 && events->events[0].kind == universe::EventKind::baseline, "initial snapshot is not a mass birth event");
        auto next = snapshot(2000, {process(10, 1), process(20, 2)});
        events = journal.observe(next, 200);
        check(events->events.back().kind == universe::EventKind::created && events->events.back().pid == 20, "real observation appearance");
        check(events->events.back().previous_observed_at_unix_ms == 1000 && events->events.back().monotonic_ns == 200, "event interval and monotonic timestamp");
        auto changes = universe::diff_snapshots(&first, next);
        check(changes.process_upserts.size() == 1 && changes.galaxy_upserts.size() == 1 && changes.process_removals.empty(), "creation diff");
        check(universe::diff_snapshots(&next, next).process_upserts.empty(), "unchanged snapshot sends no process rows");
        auto changed = next;
        changed.processes[0].cpu_percent = 10;
        changed.universe = std::make_shared<universe::UniverseModel>(universe::build_universe(changed));
        changes = universe::diff_snapshots(&next, changed);
        check(changes.process_upserts.size() == 1 && changes.galaxy_upserts.size() == 1, "changed metrics and aggregate only");
        auto reused = snapshot(3000, {process(10, 3), process(20, 2)});
        events = journal.observe(reused, 300);
        check(events->events[events->events.size() - 2].kind == universe::EventKind::terminated && events->events.back().kind == universe::EventKind::created, "PID reuse yields distinct lifetimes");
        changes = universe::diff_snapshots(&next, reused);
        check(changes.process_removals.size() == 1 && changes.process_removals[0].generation == 1, "remove the prior identity, not the PID");
        auto unknown = reused;
        unknown.observed_at_unix_ms = 4000;
        unknown.processes[0].generation = 4;
        unknown.processes[0].observation.creation_filetime.reset();
        events = journal.observe(unknown, 400);
        check(events->events.back().kind == universe::EventKind::updated && events->events.back().reason == universe::EventReason::identity, "permission/identity change is not a fabricated lifecycle");
        auto failed = snapshot(5000, {});
        failed.error = 5;
        events = journal.observe(failed, 500);
        check(events->events.back().kind == universe::EventKind::gap, "collection failure reports gap, not termination");
        const auto gap_sequence = events->last_sequence;
        check(journal.observe(failed, 600)->last_sequence == gap_sequence, "repeated failure coalesces");
        events = journal.observe(reused, 700);
        check(events->events.back().kind == universe::EventKind::baseline, "recovery reconciles without invented births");
        auto partial = reused;
        partial.truncated = true;
        check(journal.observe(partial, 800)->events.back().kind == universe::EventKind::gap, "truncation breaks lifecycle continuity");
        check(journal.pause(6000, 900)->events.back().kind == universe::EventKind::paused, "pause is explicit");
        check(journal.observe(reused, 1000)->events.back().kind == universe::EventKind::baseline, "resume is a baseline");
        universe::EventJournal spikes;
        auto busy = snapshot(1000, {process(10, 1)});
        spikes.observe(busy, 1000000000);
        busy.processes[0].cpu_percent = 20;
        busy.observed_at_unix_ms = 2000;
        const auto before_spike = spikes.observe(busy, 2000000000)->last_sequence;
        busy.observed_at_unix_ms = 3000;
        const auto spike = spikes.observe(busy, 3000000000);
        check(spike->last_sequence == before_spike + 1 && spike->events.back().kind == universe::EventKind::resource_spike, "sustained CPU spike reaches journal");
        check(spike->events.back().resource_value == 20 && spike->events.back().resource_threshold == 10, "spike preserves measured value and policy threshold");
        check(spikes.observe(busy, 4000000000)->last_sequence == spike->last_sequence, "journal does not repeat sustained spike");
        auto appearance_only = first;
        appearance_only.processes[0].resources = {1, 2};
        check(universe::diff_snapshots(&first, appearance_only).process_upserts.size() == 1, "visual level changes reach native delta");
        universe::EventJournal burst;
        burst.observe(snapshot(1000, {}), 1);
        std::vector<universe::ProcessRow> many;
        for (uint32_t index = 1; index <= 4096; ++index) many.push_back(process(index, index));
        const auto large = snapshot(2000, std::move(many));
        const auto started = std::chrono::steady_clock::now();
        events = burst.observe(large, 2);
        check(events->events.size() == universe::recent_event_limit && events->evicted_count == 4097 - universe::recent_event_limit, "event ring remains bounded under burst");
        check(events->events.front().sequence == events->last_sequence - universe::recent_event_limit + 1, "stable event gap detection cursor");
        check(universe::diff_snapshots(&large, large).process_upserts.empty(), "4096 unchanged processes coalesce");
        std::cout << "PASS: observed lifecycle, failure/pause baselines, native diffs, bounded 4096-event burst; ms="
                  << std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - started).count() << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}