#include "universe/network.hpp"
#include <algorithm>

namespace universe {
NetworkSnapshot NetworkTracker::normalize(NetworkSnapshot snapshot) {
    std::unordered_map<std::string, uint64_t> connections;
    std::unordered_map<uint64_t, InterfaceSample> interfaces;
    if (snapshot.connections.size() > connection_limit) { snapshot.connections.resize(connection_limit); snapshot.truncated = true; }
    if (snapshot.interfaces.size() > interface_limit) { snapshot.interfaces.resize(interface_limit); snapshot.truncated = true; }
    connections.reserve(snapshot.connections.size());
    std::unordered_map<std::string, size_t> positions;
    std::vector<Connection> unique;
    unique.reserve(snapshot.connections.size());
    for (auto& row : snapshot.connections) {
        const auto identity = std::to_string(row.family) + "|" + std::to_string(row.protocol) + "|" + std::to_string(row.pid)
            + "|" + (row.owner_creation ? std::to_string(*row.owner_creation) : "unknown") + "|" + row.local_address
            + "|" + std::to_string(row.local_port) + "|" + row.remote_address.value_or("") + "|" + std::to_string(row.remote_port);
        const auto duplicate = positions.find(identity);
        if (duplicate != positions.end()) {
            auto& prior = unique[duplicate->second];
            prior.observations += row.observations;
            if (prior.state != row.state) prior.state = 0;
            continue;
        }
        const auto existing = connections_.find(identity);
        row.generation = existing == connections_.end() ? ++generation_ : existing->second;
        connections.emplace(identity, row.generation);
        positions.emplace(identity, unique.size());
        unique.push_back(std::move(row));
    }
    snapshot.connections = std::move(unique);
    for (auto& row : snapshot.interfaces) {
        row.receive_bytes_per_second.reset();
        row.send_bytes_per_second.reset();
        const auto previous = interfaces_.find(row.luid);
        if (snapshot.interface_error == 0 && row.up && previous != interfaces_.end() && previous->second.up
            && snapshot.monotonic_ns > previous->second.time && row.received_bytes >= previous->second.received && row.sent_bytes >= previous->second.sent) {
            const double seconds = static_cast<double>(snapshot.monotonic_ns - previous->second.time) / 1000000000.0;
            row.receive_bytes_per_second = static_cast<double>(row.received_bytes - previous->second.received) / seconds;
            row.send_bytes_per_second = static_cast<double>(row.sent_bytes - previous->second.sent) / seconds;
        }
        if (snapshot.interface_error == 0) interfaces.emplace(row.luid, InterfaceSample{snapshot.monotonic_ns, row.received_bytes, row.sent_bytes, row.up});
    }
    connections_ = std::move(connections);
    interfaces_ = std::move(interfaces);
    std::sort(snapshot.connections.begin(), snapshot.connections.end(), [](const auto& left, const auto& right) { return left.generation < right.generation; });
    std::sort(snapshot.interfaces.begin(), snapshot.interfaces.end(), [](const auto& left, const auto& right) { return left.luid < right.luid; });
    return snapshot;
}
}