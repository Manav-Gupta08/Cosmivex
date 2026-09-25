#include "universe/model.hpp"
#include <iostream>
#include <stdexcept>

void check(bool valid, const char* message) {
    if (!valid) throw std::runtime_error(message);
}

universe::ProcessRow process(uint32_t pid, uint32_t parent, uint64_t created, const char* path) {
    universe::ProcessRow row;
    row.observation.pid = pid;
    row.observation.parent_pid = parent;
    if (created) row.observation.creation_filetime = created;
    if (path) row.observation.executable_path = path;
    row.observation.name = "same-name.exe";
    row.generation = pid;
    return row;
}

int main() {
    try {
        universe::ProcessSnapshot snapshot;
        snapshot.processes = {
            process(10, 0, 100, "C:\\apps\\first.exe"),
            process(11, 10, 110, "C:\\apps\\first.exe"),
            process(12, 11, 120, "D:\\other\\first.exe"),
            process(13, 12, 130, "D:\\other\\first.exe"),
            process(14, 0, 140, "C:\\apps\\first.exe"),
            process(15, 99, 150, nullptr),
            process(16, 17, 160, "C:\\apps\\first.exe"),
            process(17, 0, 170, "C:\\apps\\first.exe"),
            process(18, 10, 0, "C:\\apps\\first.exe"),
            process(19, 19, 190, "C:\\apps\\first.exe"),
            process(20, 10, 100, "C:\\apps\\first.exe"),
        };
        snapshot.processes[0].cpu_percent = 4;
        snapshot.processes[0].observation.working_set_bytes = 1024;
        const auto model = universe::build_universe(snapshot);
        check(model.relationships[1].parent_index == 0 && model.relationships[1].depth == 1, "verified parent and depth");
        check(model.relationships[3].depth == 3, "hierarchy crosses executable boundaries");
        check(model.relationships[0].galaxy_index == model.relationships[1].galaxy_index, "same-image ancestry groups");
        check(model.relationships[2].galaxy_index != model.relationships[1].galaxy_index, "same name is not executable identity");
        check(model.relationships[2].galaxy_index == model.relationships[3].galaxy_index, "nested application group");
        check(model.relationships[4].galaxy_index != model.relationships[0].galaxy_index, "independent roots remain independent");
        check(model.relationships[5].status == universe::ParentStatus::missing, "missing parent unresolved");
        check(model.relationships[6].parent_index == -1 && model.relationships[6].status == universe::ParentStatus::newer_or_equal, "reject reused parent PID");
        check(model.relationships[8].status == universe::ParentStatus::unavailable, "unknown creation cannot validate parent");
        check(model.relationships[9].status == universe::ParentStatus::self, "reject self parent");
        check(model.relationships[10].status == universe::ParentStatus::newer_or_equal, "equal timestamps cannot prove order");
        const auto& first = model.galaxies[model.relationships[0].galaxy_index];
        check(first.process_count == 2 && first.cpu_sample_count == 1 && first.memory_sample_count == 1, "partial aggregates expose coverage");
        check(first.cpu_percent == 4 && first.working_set_bytes == 1024, "aggregate real available samples only");
        universe::ProcessSnapshot chain;
        for (uint32_t index = 1; index <= universe::process_limit; ++index) chain.processes.push_back(process(index, index - 1, index, "C:\\chain.exe"));
        const auto large = universe::build_universe(chain);
        check(large.galaxies.size() == 1 && large.relationships.back().depth == universe::process_limit - 1, "4096-depth hierarchy without recursion");
        std::cout << "PASS: identity-validated hierarchy, conservative grouping, partial aggregates, 4096-chain ms=" << large.build_ms << '\n';
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}