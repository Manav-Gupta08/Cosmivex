#pragma once
#include <stdint.h>

#ifdef __cplusplus
#define UOS_NOEXCEPT noexcept
extern "C" {
#else
#define UOS_NOEXCEPT
#endif

enum { UOS_ABI_VERSION = 1 };
enum { UOS_ECO = 0, UOS_NORMAL = 1, UOS_CINEMATIC = 2 };
enum { UOS_TIMEOUT = 0, UOS_FRAME = 1, UOS_STOPPED = 2, UOS_INVALID = -1, UOS_ERROR = -2 };

typedef struct uos_engine uos_engine;

typedef struct uos_health {
    uint32_t abi_version;
    uint32_t struct_size;
    uint64_t sequence;
    uint64_t uptime_ms;
    uint64_t observed_at_unix_ms;
    uint32_t interval_ms;
    uint32_t profile;
    uint32_t enabled_collectors;
    uint32_t reserved;
} uos_health;

uos_engine* uos_create(uint32_t abi_version, uint32_t health_size) UOS_NOEXCEPT;
int32_t uos_wait(uos_engine* engine, uint64_t after_sequence, uint32_t timeout_ms,
                 uos_health* output, uint32_t output_size) UOS_NOEXCEPT;
int32_t uos_set_profile(uos_engine* engine, uint32_t profile) UOS_NOEXCEPT;
void uos_stop(uos_engine* engine) UOS_NOEXCEPT;
void uos_destroy(uos_engine* engine) UOS_NOEXCEPT;

#ifdef __cplusplus
}
#endif