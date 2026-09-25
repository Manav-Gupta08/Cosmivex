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
typedef struct uos_process_snapshot uos_process_snapshot;

typedef struct uos_process_info {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t count;
    uint32_t logical_cpus;
    uint32_t error;
    uint32_t truncated;
    uint64_t observed_at_unix_ms;
    double collection_ms;
} uos_process_info;

typedef struct uos_process_row {
    uint64_t creation_filetime;
    uint64_t generation;
    uint64_t working_set_bytes;
    double cpu_percent;
    uint32_t pid;
    uint32_t parent_pid;
    uint32_t thread_count;
    uint32_t available;
    uint32_t timing_error;
    uint32_t memory_error;
    const char* name;
    uint32_t name_length;
    uint32_t reserved;
} uos_process_row;

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

typedef struct uos_model_info {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t galaxy_count;
    uint32_t reserved;
    double build_ms;
} uos_model_info;

typedef struct uos_relationship {
    int32_t parent_index;
    uint32_t status;
    uint32_t galaxy_index;
    uint32_t depth;
} uos_relationship;

typedef struct uos_galaxy {
    uint32_t root_index;
    uint32_t process_count;
    uint32_t cpu_sample_count;
    uint32_t memory_sample_count;
    double cpu_percent;
    uint64_t working_set_bytes;
    const char* executable_path;
    uint32_t path_length;
    uint32_t image_error;
} uos_galaxy;

uos_engine* uos_create(uint32_t abi_version, uint32_t health_size) UOS_NOEXCEPT;
int32_t uos_wait(uos_engine* engine, uint64_t after_sequence, uint32_t timeout_ms,
                 uos_health* output, uint32_t output_size) UOS_NOEXCEPT;
int32_t uos_set_profile(uos_engine* engine, uint32_t profile) UOS_NOEXCEPT;
int32_t uos_set_process_collection(uos_engine* engine, uint32_t enabled) UOS_NOEXCEPT;
int32_t uos_acquire_processes(uos_engine* engine, uint64_t sequence, uos_process_snapshot** output) UOS_NOEXCEPT;
int32_t uos_process_info_read(const uos_process_snapshot* snapshot, uos_process_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_process_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_process_row* output, uint32_t size) UOS_NOEXCEPT;
void uos_release_processes(uos_process_snapshot* snapshot) UOS_NOEXCEPT;
int32_t uos_model_info_read(const uos_process_snapshot* snapshot, uos_model_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_relationship_read(const uos_process_snapshot* snapshot, uint32_t index, uos_relationship* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_galaxy_read(const uos_process_snapshot* snapshot, uint32_t index, uos_galaxy* output, uint32_t size) UOS_NOEXCEPT;
void uos_stop(uos_engine* engine) UOS_NOEXCEPT;
void uos_destroy(uos_engine* engine) UOS_NOEXCEPT;

#ifdef __cplusplus
}
#endif