#include "universe/engine.h"
#include <chrono>
#include <condition_variable>
#include <cstddef>
#include <mutex>
#include <thread>
#include <type_traits>

using SteadyClock = std::chrono::steady_clock;
using Milliseconds = std::chrono::milliseconds;

static_assert(std::is_standard_layout_v<uos_health>);
static_assert(sizeof(uos_health) == 48);
static_assert(offsetof(uos_health, sequence) == 8);
static_assert(offsetof(uos_health, interval_ms) == 32);

struct uos_engine {
    std::mutex mutex;
    std::condition_variable changed;
    bool stopped = false;
    uint64_t configuration_revision = 0;
    SteadyClock::time_point started = SteadyClock::now();
    uos_health latest{UOS_ABI_VERSION, sizeof(uos_health), 0, 0, 0, 2000, UOS_NORMAL, 0, 0};
    std::jthread worker;

    uos_engine() {
        publish();
        worker = std::jthread([this] {
            std::unique_lock lock(mutex);
            while (!stopped) {
                const auto revision = configuration_revision;
                const auto interrupted = changed.wait_for(lock, Milliseconds(latest.interval_ms),
                    [this, revision] { return stopped || configuration_revision != revision; });
                if (!interrupted) {
                    publish();
                    changed.notify_all();
                }
            }
        });
    }

    void publish() {
        ++latest.sequence;
        latest.uptime_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<Milliseconds>(SteadyClock::now() - started).count());
        latest.observed_at_unix_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<Milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count());
    }
};

uos_engine* uos_create(uint32_t abi_version, uint32_t health_size) noexcept {
    if (abi_version != UOS_ABI_VERSION || health_size != sizeof(uos_health)) return nullptr;
    try { return new uos_engine; } catch (...) { return nullptr; }
}

int32_t uos_wait(uos_engine* engine, uint64_t after_sequence, uint32_t timeout_ms,
                 uos_health* output, uint32_t output_size) noexcept {
    if (!engine || !output || output_size != sizeof(uos_health) || timeout_ms > 30000) return UOS_INVALID;
    try {
        std::unique_lock lock(engine->mutex);
        engine->changed.wait_for(lock, Milliseconds(timeout_ms), [engine, after_sequence] {
            return engine->stopped || engine->latest.sequence > after_sequence;
        });
        if (engine->stopped) return UOS_STOPPED;
        if (engine->latest.sequence <= after_sequence) return UOS_TIMEOUT;
        *output = engine->latest;
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

int32_t uos_set_profile(uos_engine* engine, uint32_t profile) noexcept {
    if (!engine || profile > UOS_CINEMATIC) return UOS_INVALID;
    try {
        std::lock_guard lock(engine->mutex);
        if (engine->stopped) return UOS_STOPPED;
        if (engine->latest.profile == profile) return UOS_FRAME;
        engine->latest.profile = profile;
        engine->latest.interval_ms = profile == UOS_ECO ? 5000 : 2000;
        ++engine->configuration_revision;
        engine->publish();
        engine->changed.notify_all();
        return UOS_FRAME;
    } catch (...) { return UOS_ERROR; }
}

void uos_stop(uos_engine* engine) noexcept {
    if (!engine) return;
    try {
        std::lock_guard lock(engine->mutex);
        engine->stopped = true;
        engine->changed.notify_all();
    } catch (...) {}
}

void uos_destroy(uos_engine* engine) noexcept {
    if (!engine) return;
    uos_stop(engine);
    try { delete engine; } catch (...) {}
}