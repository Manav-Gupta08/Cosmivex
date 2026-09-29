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
typedef struct uos_delta uos_delta;

typedef struct uos_event_info {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t count;
    uint32_t reserved;
    uint64_t last_sequence;
    uint64_t evicted_count;
} uos_event_info;

typedef struct uos_event_row {
    uint64_t sequence;
    uint64_t observed_at_unix_ms;
    uint64_t previous_observed_at_unix_ms;
    uint64_t monotonic_ns;
    uint64_t generation;
    uint32_t pid;
    uint32_t kind;
    uint32_t reason;
    uint32_t name_length;
    const char* name;
} uos_event_row;

typedef struct uos_delta_info {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t count;
    uint32_t reserved;
} uos_delta_info;

typedef struct uos_change_row {
    uint32_t kind;
    uint32_t index;
    uint32_t pid;
    uint32_t reserved;
    uint64_t generation;
} uos_change_row;

typedef struct uos_resource_visual {
    int32_t cpu_level;
    int32_t memory_level;
} uos_resource_visual;

typedef struct uos_resource_event {
    double value;
    double threshold;
} uos_resource_event;

typedef struct uos_network_info {
    uint32_t abi_version;
    uint32_t struct_size;
    uint32_t enabled;
    uint32_t connection_count;
    uint32_t interface_count;
    uint32_t truncated;
    uint32_t table_errors[4];
    uint32_t interface_error;
    uint32_t reserved;
    uint64_t observed_at_unix_ms;
    double collection_ms;
} uos_network_info;

typedef struct uos_connection_row {
    uint64_t generation;
    uint64_t owner_creation;
    uint32_t pid;
    uint32_t family;
    uint32_t protocol;
    uint32_t state;
    uint32_t local_port;
    uint32_t remote_port;
    uint32_t owner_error;
    uint32_t observations;
    const char* local_address;
    const char* remote_address;
    uint32_t local_length;
    uint32_t remote_length;
} uos_connection_row;

typedef struct uos_interface_row {
    uint64_t luid;
    uint64_t received_bytes;
    uint64_t sent_bytes;
    double receive_rate;
    double send_rate;
    uint32_t index;
    uint32_t type;
    uint32_t up;
    uint32_t rates_available;
    const char* name;
    uint32_t name_length;
    uint32_t reserved;
} uos_interface_row;

typedef struct uos_filesystem_info {
    uint32_t abi_version, struct_size;
    uint64_t revision, scope, observed_at_unix_ms, evicted_events;
    uint32_t error, watch_error, watching, truncated, entry_count, event_count;
    double scan_ms;
    const char* root;
    const char* relative;
    uint32_t root_length, relative_length;
} uos_filesystem_info;
typedef struct uos_file_entry {
    uint64_t generation, file_id, created_ticks, modified_unix_ms, size;
    uint32_t attributes, directory, reparse, name_length;
    const char* name;
} uos_file_entry;
typedef struct uos_file_event {
    uint64_t sequence, observed_at_unix_ms;
    uint32_t kind, name_length, previous_length, reserved;
    const char* name;
    const char* previous_name;
} uos_file_event;

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
int32_t uos_set_network_collection(uos_engine* engine, uint32_t enabled) UOS_NOEXCEPT;
int32_t uos_filesystem_command(uos_engine* engine, uint32_t action, const char* root, uint32_t length, uint64_t scope, uint64_t entry) UOS_NOEXCEPT;
int32_t uos_filesystem_info_read(const uos_process_snapshot* snapshot, uos_filesystem_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_file_entry_read(const uos_process_snapshot* snapshot, uint32_t index, uos_file_entry* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_file_event_read(const uos_process_snapshot* snapshot, uint32_t index, uos_file_event* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_network_info_read(const uos_process_snapshot* snapshot, uos_network_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_connection_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_connection_row* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_interface_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_interface_row* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_acquire_processes(uos_engine* engine, uint64_t sequence, uos_process_snapshot** output) UOS_NOEXCEPT;
int32_t uos_process_info_read(const uos_process_snapshot* snapshot, uos_process_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_process_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_process_row* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_resource_visual_read(const uos_process_snapshot* snapshot, uint32_t index, uos_resource_visual* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_resource_event_read(const uos_process_snapshot* snapshot, uint32_t index, uos_resource_event* output, uint32_t size) UOS_NOEXCEPT;
void uos_release_processes(uos_process_snapshot* snapshot) UOS_NOEXCEPT;
int32_t uos_event_info_read(const uos_process_snapshot* snapshot, uos_event_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_event_row_read(const uos_process_snapshot* snapshot, uint32_t index, uos_event_row* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_delta_create(const uos_process_snapshot* base, const uos_process_snapshot* current, uos_delta** output) UOS_NOEXCEPT;
int32_t uos_delta_info_read(const uos_delta* delta, uos_delta_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_delta_row_read(const uos_delta* delta, uint32_t index, uos_change_row* output, uint32_t size) UOS_NOEXCEPT;
void uos_delta_release(uos_delta* delta) UOS_NOEXCEPT;
int32_t uos_model_info_read(const uos_process_snapshot* snapshot, uos_model_info* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_relationship_read(const uos_process_snapshot* snapshot, uint32_t index, uos_relationship* output, uint32_t size) UOS_NOEXCEPT;
int32_t uos_galaxy_read(const uos_process_snapshot* snapshot, uint32_t index, uos_galaxy* output, uint32_t size) UOS_NOEXCEPT;
void uos_stop(uos_engine* engine) UOS_NOEXCEPT;
void uos_destroy(uos_engine* engine) UOS_NOEXCEPT;

#ifdef __cplusplus
}
#endif