#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include "universe/network.hpp"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <stdexcept>

void check(bool valid, const char* message) { if (!valid) throw std::runtime_error(message); }
struct Socket {
    SOCKET value;
    explicit Socket(int family, int type) : value(socket(family, type, 0)) { check(value != INVALID_SOCKET, "create socket"); }
    explicit Socket(SOCKET existing) : value(existing) { check(value != INVALID_SOCKET, "accepted socket"); }
    void close() { if (value != INVALID_SOCKET) { closesocket(value); value = INVALID_SOCKET; } }
    ~Socket() { close(); }
};

void verify_sockets(universe::INetworkCollector& collector, int family) {
    Socket server(family, SOCK_STREAM), client(family, SOCK_STREAM), udp(family, SOCK_DGRAM);
    sockaddr_storage target{};
    int size = 0;
    if (family == AF_INET) {
        auto* address = reinterpret_cast<sockaddr_in*>(&target);
        address->sin_family = AF_INET; address->sin_addr.s_addr = htonl(INADDR_LOOPBACK); size = sizeof(sockaddr_in);
    } else {
        auto* address = reinterpret_cast<sockaddr_in6*>(&target);
        address->sin6_family = AF_INET6; address->sin6_addr = in6addr_loopback; size = sizeof(sockaddr_in6);
    }
    check(bind(server.value, reinterpret_cast<sockaddr*>(&target), size) == 0 && listen(server.value, 1) == 0, "listen on loopback");
    check(bind(udp.value, reinterpret_cast<sockaddr*>(&target), size) == 0, "bind UDP endpoint");
    sockaddr_storage udp_address{};
    int udp_size = sizeof(udp_address);
    getsockname(udp.value, reinterpret_cast<sockaddr*>(&udp_address), &udp_size);
    getsockname(server.value, reinterpret_cast<sockaddr*>(&target), &size);
    check(connect(client.value, reinterpret_cast<sockaddr*>(&target), size) == 0, "connect controlled client");
    Socket accepted(accept(server.value, nullptr, nullptr));
    const auto tcp_port = ntohs(family == AF_INET ? reinterpret_cast<sockaddr_in*>(&target)->sin_port : reinterpret_cast<sockaddr_in6*>(&target)->sin6_port);
    const auto udp_port = ntohs(family == AF_INET ? reinterpret_cast<sockaddr_in*>(&udp_address)->sin_port : reinterpret_cast<sockaddr_in6*>(&udp_address)->sin6_port);
    const auto snapshot = collector.collect();
    const uint32_t ip_version = family == AF_INET ? 4u : 6u;
    check(snapshot.table_errors[ip_version == 4 ? 0 : 1] == 0, "TCP owner table available");
    check(snapshot.table_errors[ip_version == 4 ? 2 : 3] == 0, "UDP owner table available");
    check(std::any_of(snapshot.connections.begin(), snapshot.connections.end(), [&](const auto& row) {
        return row.family == ip_version && row.protocol == 6 && row.pid == GetCurrentProcessId() && row.local_port == tcp_port && row.state == 2 && !row.remote_address;
    }), "real TCP listener, PID, local port, no fictional peer");
    check(std::any_of(snapshot.connections.begin(), snapshot.connections.end(), [&](const auto& row) {
        return row.family == ip_version && row.protocol == 6 && row.pid == GetCurrentProcessId() && row.remote_port == tcp_port && row.remote_address && row.owner_creation && row.state == 5;
    }), "real TCP peer and owner identity");
    check(std::any_of(snapshot.connections.begin(), snapshot.connections.end(), [&](const auto& row) {
        return row.family == ip_version && row.protocol == 17 && row.pid == GetCurrentProcessId() && row.local_port == udp_port && !row.remote_address && row.remote_port == 0;
    }), "UDP is a local endpoint, not a connection to an invented peer");
    client.close(); accepted.close(); server.close(); udp.close();
    const auto closed = collector.collect();
    check(std::none_of(closed.connections.begin(), closed.connections.end(), [&](const auto& row) {
        return row.family == ip_version && row.pid == GetCurrentProcessId()
            && ((row.protocol == 17 && row.local_port == udp_port) || (row.protocol == 6 && row.local_port == tcp_port && row.state == 2));
    }), "closed TCP listener and UDP endpoint disappear");
}

int main() {
    WSADATA winsock{};
    if (WSAStartup(MAKEWORD(2, 2), &winsock)) return 1;
    try {
        auto collector = universe::make_network_collector();
        verify_sockets(*collector, AF_INET);
        verify_sockets(*collector, AF_INET6);
        const auto real = collector->collect();
        check(real.interface_error == 0 && !real.interfaces.empty(), "real interface metadata");
        universe::NetworkTracker tracker;
        universe::NetworkSnapshot first;
        first.monotonic_ns = 1000000000;
        first.interfaces.push_back({1, 1, 6, true, "fixture", 100, 200, {}, {}});
        universe::Connection connection;
        connection.pid = 42; connection.local_address = "127.0.0.1"; connection.local_port = 12345; connection.owner_creation = 100;
        first.connections.push_back(connection);
        const auto initial = tracker.normalize(first);
        check(!initial.interfaces[0].receive_bytes_per_second, "first rate unavailable");
        auto next = first;
        next.monotonic_ns = 3000000000;
        next.interfaces[0].received_bytes = 500; next.interfaces[0].sent_bytes = 800;
        const auto measured = tracker.normalize(next);
        check(*measured.interfaces[0].receive_bytes_per_second == 200 && *measured.interfaces[0].send_bytes_per_second == 300, "exact interface counter delta over monotonic time");
        check(measured.connections[0].generation == initial.connections[0].generation, "connection identity stable");
        next.monotonic_ns += 1000000000;
        next.interfaces[0].received_bytes = 1;
        next.connections[0].owner_creation = 200;
        const auto reset = tracker.normalize(next);
        check(!reset.interfaces[0].receive_bytes_per_second, "counter reset is unavailable, not negative traffic");
        check(reset.connections[0].generation != initial.connections[0].generation, "reused owner PID changes identity");
        tracker.reset();
        check(tracker.normalize(next).connections[0].generation > reset.connections[0].generation, "reset never reuses connection IDs");
        next.connections.push_back(next.connections[0]);
        const auto coalesced = tracker.normalize(next);
        check(coalesced.connections.size() == 1 && coalesced.connections[0].observations == 2, "duplicate endpoint rows coalesce explicitly");
        next.interfaces[0].up = false;
        check(!tracker.normalize(next).interfaces[0].send_bytes_per_second, "down interface has no claimed traffic rate");
        std::stop_source cancelled;
        cancelled.request_stop();
        check(collector->collect(cancelled.get_token()).table_errors[0] == ERROR_OPERATION_ABORTED, "cancel network collection");
        std::cout << "PASS: IPv4/IPv6 TCP and UDP, actual owners/endpoints/interfaces, rates, resets; connections=" << real.connections.size() << ", collection ms=" << real.collection_ms << '\n';
        WSACleanup();
        return 0;
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; WSACleanup(); return 1; }
}