#pragma once
#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <stop_token>
#include <string>
#include <unordered_map>
#include <vector>

namespace universe {
inline constexpr uint32_t connection_limit = 4096;
inline constexpr uint32_t interface_limit = 128;

struct Connection {
    uint64_t generation = 0;
    uint32_t pid = 0;
    uint32_t family = 4;
    uint32_t protocol = 6;
    uint32_t state = 0;
    uint32_t local_port = 0;
    uint32_t remote_port = 0;
    uint32_t owner_error = 0;
    uint32_t observations = 1;
    std::optional<uint64_t> owner_creation;
    std::string local_address;
    std::optional<std::string> remote_address;
};

struct NetworkInterface {
    uint64_t luid = 0;
    uint32_t index = 0;
    uint32_t type = 0;
    bool up = false;
    std::string name;
    uint64_t received_bytes = 0;
    uint64_t sent_bytes = 0;
    std::optional<double> receive_bytes_per_second;
    std::optional<double> send_bytes_per_second;
};

struct NetworkSnapshot {
    uint64_t observed_at_unix_ms = 0;
    uint64_t monotonic_ns = 0;
    double collection_ms = 0;
    std::array<uint32_t, 4> table_errors{};
    uint32_t interface_error = 0;
    bool truncated = false;
    std::vector<Connection> connections;
    std::vector<NetworkInterface> interfaces;
};

class INetworkCollector {
public:
    virtual ~INetworkCollector() = default;
    virtual NetworkSnapshot collect(std::stop_token stop = {}) = 0;
};
std::unique_ptr<INetworkCollector> make_network_collector();

class NetworkTracker {
public:
    NetworkSnapshot normalize(NetworkSnapshot snapshot);
    void reset() { connections_.clear(); interfaces_.clear(); }
private:
    struct InterfaceSample { uint64_t time; uint64_t received; uint64_t sent; bool up; };
    std::unordered_map<std::string, uint64_t> connections_;
    std::unordered_map<uint64_t, InterfaceSample> interfaces_;
    uint64_t generation_ = 0;
};
}