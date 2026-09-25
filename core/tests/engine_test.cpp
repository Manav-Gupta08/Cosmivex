#include "universe/engine.h"
#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <stdexcept>

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    try {
        require(uos_create(99, sizeof(uos_health)) == nullptr, "reject ABI mismatch");
        require(uos_create(1, 0) == nullptr, "reject struct mismatch");
        std::unique_ptr<uos_engine, decltype(&uos_destroy)> engine(
            uos_create(UOS_ABI_VERSION, sizeof(uos_health)), uos_destroy);
        require(engine != nullptr, "create engine");
        uos_health frame{};
        require(uos_wait(nullptr, 0, 0, &frame, sizeof(frame)) == UOS_INVALID, "reject null handle");
        require(uos_wait(engine.get(), 0, 0, nullptr, sizeof(frame)) == UOS_INVALID, "reject null output");
        require(uos_wait(engine.get(), 0, 0, &frame, 0) == UOS_INVALID, "reject output size");
        require(uos_wait(engine.get(), 0, 30001, &frame, sizeof(frame)) == UOS_INVALID, "bound wait time");
        require(uos_wait(engine.get(), 0, 0, &frame, sizeof(frame)) == UOS_FRAME, "initial frame");
        require(frame.sequence == 1 && frame.abi_version == 1 && frame.struct_size == 48, "ABI layout");
        require(frame.enabled_collectors == 0, "no fictional collectors");
        require(frame.observed_at_unix_ms > 1700000000000ULL, "real clock timestamp");
        require(uos_wait(engine.get(), frame.sequence, 0, &frame, sizeof(frame)) == UOS_TIMEOUT, "no duplicate frame");
        require(uos_set_profile(engine.get(), 3) == UOS_INVALID, "reject invalid profile");
        require(uos_wait(engine.get(), frame.sequence, 3000, &frame, sizeof(frame)) == UOS_FRAME, "worker publishes");
        require(frame.uptime_ms >= 1900, "real monotonic uptime");
        const auto before = frame.sequence;
        for (uint32_t index = 0; index < 10000; ++index) {
            require(uos_set_profile(engine.get(), index % 2) == UOS_FRAME, "profile update");
        }
        require(uos_wait(engine.get(), before, 0, &frame, sizeof(frame)) == UOS_FRAME, "coalesced snapshot");
        require(frame.sequence >= before + 10000, "latest state replaces backlog");
        require(uos_set_profile(engine.get(), UOS_ECO) == UOS_FRAME, "eco selected");
        require(uos_wait(engine.get(), frame.sequence, 0, &frame, sizeof(frame)) == UOS_FRAME, "eco confirmed");
        require(frame.interval_ms == 5000 && frame.profile == UOS_ECO, "native eco interval");
        auto waiter = std::async(std::launch::async, [&] {
            uos_health next{};
            return uos_wait(engine.get(), frame.sequence, 30000, &next, sizeof(next));
        });
        uos_stop(engine.get());
        require(waiter.wait_for(std::chrono::milliseconds(500)) == std::future_status::ready, "prompt shutdown");
        require(waiter.get() == UOS_STOPPED, "waiter sees stop");
        require(uos_set_profile(engine.get(), UOS_NORMAL) == UOS_STOPPED, "no updates after stop");
        uos_stop(engine.get());
        uos_destroy(nullptr);
        std::cout << "PASS: ABI, real heartbeat, 10000 coalesced updates, profiles, shutdown\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}