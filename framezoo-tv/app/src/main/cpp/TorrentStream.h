#pragma once

#include <cstdint>
#include <memory>
#include <string>

class TorrentStream {
public:
    TorrentStream();
    ~TorrentStream();
    std::string start(std::string magnet, int fileIndex);
    std::int64_t size() const;
    void cancel_start();
    void cancel();
    void seek(std::int64_t offset);
    std::int64_t read(std::int64_t offset, char* target, std::uint64_t wanted);
private:
    struct Impl;
    std::unique_ptr<Impl> impl;
};
