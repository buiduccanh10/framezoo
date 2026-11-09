/*

Copyright (c) 2017-2018, Steven Siloti
Copyright (c) 2019-2021, Arvid Norberg
All rights reserved.

You may use, distribute and modify this code under the terms of the BSD license,
see LICENSE file.
*/

#include <cstdlib>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <thread>
#include <vector>
#include <android/log.h>
#include "TorrentStream.h"
#include "libtorrent/libtorrent.hpp"

#include <iostream>
#include <sstream>

namespace {

// -- example begin
struct temp_storage
{
	explicit temp_storage(lt::file_storage const& fs) : m_files(fs) {}

	bool readv(lt::peer_request const r, char* out, lt::storage_error& ec) const
	{
		std::lock_guard<std::mutex> lock(m_mutex);
		auto const i = m_file_data.find(r.piece);
		if (i == m_file_data.end())
		{
			ec.operation = lt::operation_t::file_read;
			ec.ec = boost::asio::error::eof;
			return false;
		}
		if (r.start < 0 || r.length < 0 || r.start + r.length > int(i->second.size()))
		{
			ec.operation = lt::operation_t::file_read;
			ec.ec = boost::asio::error::eof;
			return false;
		}
		std::memcpy(out, i->second.data() + r.start, std::size_t(r.length));
		return true;
	}
	bool writev(lt::span<char const> const b, lt::piece_index_t const piece, int const offset)
	{
		std::lock_guard<std::mutex> lock(m_mutex);
		auto& data = m_file_data[piece];
		if (data.empty())
		{
			int const size = piece_size(piece);
			while (m_bytes + size > 128 * 1024 * 1024 && evict_one(piece)) {}
			if (m_bytes + size > 128 * 1024 * 1024) return false;
			data.resize(std::size_t(size));
			m_bytes += size;
		}
		if (offset < 0 || offset + b.size() > int(data.size())) return false;
		std::memcpy(data.data() + offset, b.data(), std::size_t(b.size()));
		return true;
	}
	void verified(lt::piece_index_t piece) { std::lock_guard<std::mutex> lock(m_mutex); m_verified.insert(piece); m_evicted.erase(piece); m_changed.notify_all(); }
	void clear(lt::piece_index_t piece) { std::lock_guard<std::mutex> lock(m_mutex); erase(piece); }
	bool has(lt::piece_index_t piece) const { std::lock_guard<std::mutex> lock(m_mutex); return m_verified.count(piece) != 0; }
	bool was_evicted(lt::piece_index_t piece) const { std::lock_guard<std::mutex> lock(m_mutex); return m_evicted.count(piece) != 0; }
	void center(lt::piece_index_t piece) { std::lock_guard<std::mutex> lock(m_mutex); m_center = piece; }
	bool wait_piece(lt::piece_index_t piece, std::atomic<bool> const& cancelled, std::chrono::seconds timeout) {
		std::unique_lock<std::mutex> lock(m_mutex);
		return m_changed.wait_for(lock, timeout, [&] { return m_verified.count(piece) || cancelled; }) && m_verified.count(piece);
	}
	bool copy(lt::piece_index_t piece, int offset, char* out, int length) const {
		std::lock_guard<std::mutex> lock(m_mutex);
		auto i = m_file_data.find(piece);
		if (i == m_file_data.end() || !m_verified.count(piece) || offset + length > int(i->second.size())) return false;
		std::memcpy(out, i->second.data() + offset, std::size_t(length));
		return true;
	}
	void wake() { m_changed.notify_all(); }
	lt::sha1_hash hash(lt::piece_index_t const piece
		, lt::span<lt::sha256_hash> const block_hashes, lt::storage_error& ec) const
	{
		std::lock_guard<std::mutex> lock(m_mutex);
		auto const i = m_file_data.find(piece);
		if (i == m_file_data.end())
		{
			// A missing RAM piece must fail the hash without aborting the full recheck.
			return {};
		}
		if (!block_hashes.empty())
		{
			int const piece_size2 = m_files.piece_size2(piece);
			int const blocks_in_piece2 = m_files.blocks_in_piece2(piece);
			char const* buf = i->second.data();
			std::int64_t offset = 0;
			for (int k = 0; k < blocks_in_piece2; ++k)
			{
				lt::hasher256 h2;
				std::ptrdiff_t const len2 = std::min(lt::default_block_size, int(piece_size2 - offset));
				h2.update({ buf, len2 });
				buf += len2;
				offset += len2;
				block_hashes[k] = h2.final();
			}
		}
		return lt::hasher(i->second).final();
	}
	lt::sha256_hash hash2(lt::piece_index_t const piece, int const offset, lt::storage_error& ec)
	{
		std::lock_guard<std::mutex> lock(m_mutex);
		auto const i = m_file_data.find(piece);
		if (i == m_file_data.end())
		{
			return {};
		}

		int const piece_size = m_files.piece_size2(piece);

		std::ptrdiff_t const len = std::min(lt::default_block_size, piece_size - offset);

		lt::span<char const> b = {i->second.data() + offset, len};
		return lt::hasher256(b).final();
	}

private:
	bool evict_one(lt::piece_index_t incoming) {
		int const ahead = std::clamp((64 * 1024 * 1024) / m_files.piece_length(), 2, 24);
		for (auto p : m_verified) {
			int const index = static_cast<int>(p);
			int const center = static_cast<int>(m_center);
			if (p == incoming || (index >= center - 2 && index <= center + ahead)) continue;
			erase(p);
			m_evicted.insert(p);
			__android_log_print(ANDROID_LOG_INFO, "FrameZooTorrent", "evicted piece=%d cached=%zu", static_cast<int>(p), m_bytes);
			return true;
		}
		return false;
	}
	void erase(lt::piece_index_t piece) {
		auto i = m_file_data.find(piece);
		if (i != m_file_data.end()) { m_bytes -= i->second.size(); m_file_data.erase(i); }
		m_verified.erase(piece);
	}
	int piece_size(lt::piece_index_t piece) const
	{
		int const num_pieces = static_cast<int>((m_files.total_size() + m_files.piece_length() - 1) / m_files.piece_length());
		return static_cast<int>(piece) < num_pieces - 1
			? m_files.piece_length() : static_cast<int>(m_files.total_size() - std::int64_t(num_pieces - 1) * m_files.piece_length());
	}

	lt::file_storage const& m_files;
	std::map<lt::piece_index_t, std::vector<char>> m_file_data;
	mutable std::mutex m_mutex;
	std::condition_variable m_changed;
	std::set<lt::piece_index_t> m_verified;
	std::set<lt::piece_index_t> m_evicted;
	lt::piece_index_t m_center{0};
	std::size_t m_bytes{0};
};

lt::storage_index_t pop(std::vector<lt::storage_index_t>& q)
{
	TORRENT_ASSERT(!q.empty());
	lt::storage_index_t const ret = q.back();
	q.pop_back();
	return ret;
}

struct temp_disk_io final : lt::disk_interface
	, lt::buffer_allocator_interface
{
	explicit temp_disk_io(lt::io_context& ioc): m_ioc(ioc) {}

	void settings_updated() override {}

	lt::storage_holder new_torrent(lt::storage_params const& params
		, std::shared_ptr<void> const&) override
	{
		lt::storage_index_t const idx = m_free_slots.empty()
			? m_torrents.end_index()
			: pop(m_free_slots);
		auto storage = std::make_shared<temp_storage>(params.files);
		if (idx == m_torrents.end_index()) m_torrents.emplace_back(std::move(storage));
		else m_torrents[idx] = std::move(storage);
		return lt::storage_holder(idx, *this);
	}

	void remove_torrent(lt::storage_index_t const idx) override
	{
		m_torrents[idx].reset();
		m_free_slots.push_back(idx);
	}

	void abort(bool) override {}
	std::shared_ptr<temp_storage> active_storage() const { return m_torrents.empty() ? nullptr : m_torrents[lt::storage_index_t{0}]; }

	void async_read(lt::storage_index_t storage, lt::peer_request const& r
		, std::function<void(lt::disk_buffer_holder block, lt::storage_error const& se)> handler
		, lt::disk_job_flags_t) override
	{
		char* block = static_cast<char*>(std::malloc(std::size_t(r.length)));
		lt::storage_error error;
		m_torrents[storage]->readv(r, block, error);

		post(m_ioc, [handler, error, block, this] {
			handler(lt::disk_buffer_holder(*this, block), error);
		});
	}

	bool async_write(lt::storage_index_t storage, lt::peer_request const& r
		, char const* buf, std::shared_ptr<lt::disk_observer>
		, std::function<void(lt::storage_error const&)> handler
		, lt::disk_job_flags_t) override
	{
		lt::span<char const> const b = { buf, r.length };

		bool ok = m_torrents[storage]->writev(b, r.piece, r.start);
		lt::storage_error error;
		if (!ok) { error.operation = lt::operation_t::file_write; error.ec = boost::asio::error::no_memory; }
		post(m_ioc, [=]{ handler(error); });
		return false;
	}

	void async_hash(lt::storage_index_t storage, lt::piece_index_t const piece
		, lt::span<lt::sha256_hash> block_hashes, lt::disk_job_flags_t
		, std::function<void(lt::piece_index_t, lt::sha1_hash const&, lt::storage_error const&)> handler) override
	{
		lt::storage_error error;
		lt::sha1_hash const hash = m_torrents[storage]->hash(piece, block_hashes, error);
		post(m_ioc, [=]{ handler(piece, hash, error); });
	}

	void async_hash2(lt::storage_index_t storage, lt::piece_index_t const piece
		, int const offset, lt::disk_job_flags_t
		, std::function<void(lt::piece_index_t, lt::sha256_hash const&, lt::storage_error const&)> handler) override
	{
		lt::storage_error error;
		lt::sha256_hash const hash = m_torrents[storage]->hash2(piece, offset, error);
		post(m_ioc, [=]{ handler(piece, hash, error); });
	}

	void async_move_storage(lt::storage_index_t, std::string p, lt::move_flags_t
		, std::function<void(lt::status_t, std::string const&, lt::storage_error const&)> handler) override
	{
		post(m_ioc, [=]{
			handler(lt::disk_status::fatal_disk_error, p
				, lt::storage_error(lt::error_code(boost::system::errc::operation_not_supported, lt::system_category())));
		});
	}

	void async_release_files(lt::storage_index_t, std::function<void()> handler) override { if (handler) post(m_ioc, std::move(handler)); }

	void async_delete_files(lt::storage_index_t, lt::remove_flags_t
		, std::function<void(lt::storage_error const&)> handler) override
	{
		post(m_ioc, [=]{ handler(lt::storage_error()); });
	}

	void async_check_files(lt::storage_index_t
		, lt::add_torrent_params const* params
		, lt::aux::vector<std::string, lt::file_index_t>
		, std::function<void(lt::status_t, lt::storage_error const&)> handler) override
	{
		bool const fullCheck = params == nullptr;
		post(m_ioc, [=]{ handler(fullCheck ? lt::disk_status::need_full_check : lt::status_t{}, lt::storage_error()); });
	}

	void async_rename_file(lt::storage_index_t
		, lt::file_index_t const idx
		, std::string const name
		, std::function<void(std::string const&, lt::file_index_t, lt::storage_error const&)> handler) override
	{
		post(m_ioc, [=]{ handler(name, idx, lt::storage_error()); });
	}

	void async_stop_torrent(lt::storage_index_t, std::function<void()> handler) override
	{
		if (handler) post(m_ioc, std::move(handler));
	}

	void async_set_file_priority(lt::storage_index_t
		, lt::aux::vector<lt::download_priority_t, lt::file_index_t> prio
		, std::function<void(lt::storage_error const&
			, lt::aux::vector<lt::download_priority_t, lt::file_index_t>)> handler) override
	{
		post(m_ioc, [=]{
			handler(lt::storage_error(), std::move(prio));
		});
	}

	void async_clear_piece(lt::storage_index_t, lt::piece_index_t index
		, std::function<void(lt::piece_index_t)> handler) override
	{
		active_storage()->clear(index);
		post(m_ioc, [=]{ handler(index); });
	}

	// implements buffer_allocator_interface
	void free_disk_buffer(char* buffer) override
	{
		std::free(buffer);
	}
	void free_multiple_buffers(lt::span<char*> buffers) override
	{
		for (char* buffer : buffers) std::free(buffer);
	}
#if TORRENT_DEBUG_BUFFER_POOL
	void rename_buffer(char*, char const*) override {}
#endif

	void update_stats_counters(lt::counters&) const override {}

	std::vector<lt::open_file_state> get_status(lt::storage_index_t) const override
	{ return {}; }

	void submit_jobs() override {}

private:

	lt::aux::vector<std::shared_ptr<temp_storage>, lt::storage_index_t> m_torrents;

	// slots that are unused in the m_torrents vector
	std::vector<lt::storage_index_t> m_free_slots;

	// callbacks are posted on this
	lt::io_context& m_ioc;
};

std::unique_ptr<lt::disk_interface> temp_disk_constructor(
	lt::io_context& ioc, lt::settings_interface const&, lt::counters&)
{
	return std::make_unique<temp_disk_io>(ioc);
}
// -- example end

} // anonymous namespace

struct TorrentStream::Impl {
public:
	Impl() {
		lt::session_params params;
		params.disk_io_constructor = [this](lt::io_context& io, lt::settings_interface const&, lt::counters&) {
			auto result = std::make_unique<temp_disk_io>(io);
			disk = result.get();
			return result;
		};
		params.settings.set_int(lt::settings_pack::alert_mask,
			lt::alert_category::status | lt::alert_category::error | lt::alert_category::storage | lt::alert_category::piece_progress | lt::alert_category::peer);
		params.settings.set_bool(lt::settings_pack::close_redundant_connections, false);
		params.settings.set_bool(lt::settings_pack::enable_dht, true);
		params.settings.set_bool(lt::settings_pack::enable_lsd, true);
		params.settings.set_bool(lt::settings_pack::enable_incoming_utp, true);
		params.settings.set_bool(lt::settings_pack::enable_outgoing_utp, true);
		params.settings.set_bool(lt::settings_pack::enable_incoming_tcp, true);
		params.settings.set_bool(lt::settings_pack::enable_outgoing_tcp, true);
		params.settings.set_str(lt::settings_pack::dht_bootstrap_nodes,
			"router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881");
		params.settings.set_int(lt::settings_pack::connections_limit, 200);
		params.settings.set_int(lt::settings_pack::connection_speed, 60);
		params.settings.set_int(lt::settings_pack::torrent_connect_boost, 80);
		params.settings.set_int(lt::settings_pack::min_reconnect_time, 1);
		session = std::make_unique<lt::session>(std::move(params));
		alerts = std::thread([this] { alert_loop(); });
	}
	~Impl() {
		stopped = true;
		cancelled = true;
		if (auto storage = disk ? disk->active_storage() : nullptr) storage->wake();
		if (alerts.joinable()) alerts.join();
		handle = {};
		session.reset();
	}

	std::string start(std::string magnet, int requestedFile) {
		try {
			lt::add_torrent_params params = lt::parse_magnet_uri(magnet);
			peers = params.peers;
			params.save_path = "."; // disk_interface never opens this path
			handle = session->add_torrent(std::move(params));
			std::unique_lock<std::mutex> lock(mutex);
			for (int elapsed = 0; elapsed < 60; ++elapsed) {
				if (changed.wait_for(lock, std::chrono::seconds(1), [this] { return cancelled || metadataReady || !error.empty(); }))
					break;
				if (elapsed % 4 == 3 && handle.is_valid()) {
					handle.force_reannounce(0, -1, lt::torrent_handle::ignore_min_interval);
					handle.force_dht_announce();
				}
			}
			if (cancelled) return "Đã dừng torrent";
			if (!error.empty()) return error;
			if (!metadataReady || !info) return "Hết thời gian lấy metadata torrent";
			auto const& files = info->layout();
			std::int64_t largest = -1;
			for (int i = 0; i < files.num_files(); ++i) {
				lt::file_index_t index{i};
				std::string path = files.file_path(index);
				std::transform(path.begin(), path.end(), path.begin(), [](char c) { return char(std::tolower(c)); });
				auto ends = [&](char const* suffix) { std::size_t n = std::strlen(suffix); return path.size() >= n && path.compare(path.size() - n, n, suffix) == 0; };
				bool video = ends(".mkv") || ends(".mp4") || ends(".webm") || ends(".avi") || ends(".mov");
				if (video && files.file_size(index) > largest) { largest = files.file_size(index); selectedFile = index; }
			}
			if (requestedFile >= 0 && requestedFile < files.num_files()) selectedFile = lt::file_index_t{requestedFile};
			if (selectedFile < lt::file_index_t{0} || selectedFile >= files.end_file()) return "Torrent không có file video hợp lệ";
			fileSize = files.file_size(selectedFile);
			if (fileSize <= 0) return "File torrent rỗng";
			std::vector<lt::download_priority_t> priorities(std::size_t(files.num_files()), lt::dont_download);
			priorities[static_cast<int>(selectedFile)] = lt::default_priority;
			lock.unlock();
			handle.prioritize_files(priorities);
			lock.lock();
			if (!changed.wait_for(lock, std::chrono::seconds(10), [this] { return cancelled || filePrioritiesReady || !error.empty(); }))
				return "Hết thời gian đặt ưu tiên file torrent";
			if (cancelled) return "Đã dừng torrent";
			if (!error.empty()) return error;
			lock.unlock();
			std::vector<lt::download_priority_t> pieces(static_cast<int>(info->end_piece()), lt::dont_download);
			handle.prioritize_pieces(pieces);
			prioritize(0, true);
			return {};
		} catch (std::exception const& e) { return e.what(); }
	}

	std::int64_t size() const { return fileSize; }
	void cancel_start() { cancelled = true; changed.notify_all(); }
	void cancel() { cancelled = true; changed.notify_all(); if (auto storage = disk ? disk->active_storage() : nullptr) storage->wake(); }
	void seek(std::int64_t offset) {
		cancelled = false;
		if (offset >= fileSize) return;
		prioritize(offset);
		if (auto storage = disk ? disk->active_storage() : nullptr) {
			auto request = info->layout().map_file(selectedFile, offset, 1);
			ensure_missing(request.piece, storage);
		}
	}
	std::int64_t read(std::int64_t offset, char* target, std::uint64_t wanted) {
		if (!info || offset >= fileSize || cancelled) return 0;
		int total = int(std::min<std::int64_t>({std::int64_t(wanted), fileSize - offset, 1024 * 1024}));
		int copied = 0;
		while (copied < total && !cancelled) {
			auto request = info->layout().map_file(selectedFile, offset + copied, total - copied);
			int chunk = std::min(total - copied, info->piece_length() - request.start);
			auto storage = disk ? disk->active_storage() : nullptr;
			if (!storage) return copied ? copied : -1;
			storage->center(request.piece);
			if (!storage->has(request.piece)) {
				prioritize(offset + copied);
				ensure_missing(request.piece, storage);
				auto status = handle.status();
				__android_log_print(ANDROID_LOG_INFO, "FrameZooTorrent", "wait piece=%d priority=%d state=%d paused=%d peers=%d rate=%d wanted=%lld done=%lld",
					static_cast<int>(request.piece), int(static_cast<std::uint8_t>(handle.piece_priority(request.piece))),
					int(status.state), int(bool(status.flags & lt::torrent_flags::paused)), status.num_peers, status.download_rate,
					static_cast<long long>(status.total_wanted), static_cast<long long>(status.total_wanted_done));
				int waitedSeconds = 0;
				while (!storage->wait_piece(request.piece, cancelled, std::chrono::seconds(2))) {
					if (cancelled) return copied ? copied : -1;
					waitedSeconds += 2;
					focus_piece(request.piece, waitedSeconds >= 4);
					if (waitedSeconds % 6 == 0 && handle.is_valid()) {
						handle.force_reannounce(0, -1, lt::torrent_handle::ignore_min_interval);
						handle.force_dht_announce();
					}
					if (waitedSeconds >= 90) return copied ? copied : -1;
				}
			}
			if (!storage->copy(request.piece, request.start, target + copied, chunk)) return copied ? copied : -1;
			copied += chunk;
		}
		return copied;
	}

	void add_peer(std::string const& host, int port) {
		if (port <= 0 || port > 65535 || host.empty()) return;
		boost::system::error_code ec;
		auto addr = lt::make_address(host, ec);
		if (ec) return;
		lt::tcp::endpoint ep(addr, static_cast<std::uint16_t>(port));
		{
			std::lock_guard<std::mutex> lock(prioritiesMutex);
			if (std::find(peers.begin(), peers.end(), ep) == peers.end()) {
				peers.push_back(ep);
			}
		}
		if (handle.is_valid()) {
			handle.connect_peer(ep);
		}
	}

	std::string stats_json() const {
		if (!handle.is_valid()) {
			return "{\"state\":\"opening\",\"peers\":0,\"downloadRate\":0,\"progress\":0.0,\"downloadedBytes\":0,\"totalBytes\":0}";
		}
		auto status = handle.status();
		std::string stateStr = "downloading";
		if (!metadataReady) stateStr = "metadata";
		else if (status.state == lt::torrent_status::checking_files || status.state == lt::torrent_status::checking_resume_data) stateStr = "checking";
		else if (status.state == lt::torrent_status::seeding || status.state == lt::torrent_status::finished) stateStr = "seeding";
		double prog = 0.0;
		if (fileSize > 0) {
			prog = std::min(1.0, double(status.total_wanted_done) / double(fileSize));
		}
		std::ostringstream oss;
		oss << "{\"state\":\"" << stateStr << "\""
		    << ",\"peers\":" << status.num_peers
		    << ",\"seeds\":" << status.num_seeds
		    << ",\"downloadRate\":" << status.download_rate
		    << ",\"progress\":" << prog
		    << ",\"downloadedBytes\":" << status.total_wanted_done
		    << ",\"totalBytes\":" << (fileSize > 0 ? fileSize : status.total_wanted)
		    << "}";
		return oss.str();
	}

private:
	void ensure_missing(lt::piece_index_t piece, std::shared_ptr<temp_storage> const& storage) {
		if (storage->was_evicted(piece) && handle.have_piece(piece) && !recheckPending.exchange(true)) {
			__android_log_print(ANDROID_LOG_INFO, "FrameZooTorrent", "recheck evicted piece=%d", static_cast<int>(piece));
			// ponytail: one torrent per player; leave auto-managed mode before recheck so queued resume cannot stall playback.
			handle.unset_flags(lt::torrent_flags::auto_managed | lt::torrent_flags::paused);
			handle.force_recheck();
		}
	}
	void focus_piece(lt::piece_index_t targetPiece, bool kick) {
		if (!info || !handle.is_valid()) return;
		std::lock_guard<std::mutex> lock(prioritiesMutex);
		for (auto piece : hotPieces) {
			if (piece != targetPiece) {
				handle.piece_priority(piece, lt::download_priority_t{2});
			}
		}
		if (kick) {
			// Cancel non-critical in-flight block requests from slow peers and re-request from fastest peers
			handle.reset_piece_deadline(targetPiece);
		}
		handle.piece_priority(targetPiece, lt::top_priority);
		handle.set_piece_deadline(targetPiece, 0);
	}
	void prioritize(std::int64_t offset, bool force = false) {
		if (!info || fileSize <= 0) return;
		std::lock_guard<std::mutex> lock(prioritiesMutex);
		currentOffset = offset;
		auto start = info->layout().map_file(selectedFile, std::min(offset, fileSize - 1), 1).piece;
		if (auto storage = disk ? disk->active_storage() : nullptr) storage->center(start);
		if (start == currentPiece && !force) return;
		currentPiece = start;
		int const endPiece = static_cast<int>(info->end_piece());
		int const startIdx = static_cast<int>(start);
		int const ahead = std::clamp((16 * 1024 * 1024) / info->piece_length(), 3, 8);
		std::map<lt::piece_index_t, std::pair<lt::download_priority_t, int>> desired;

		// Top priority (7) ONLY on the immediate playhead piece and next piece so bandwidth isn't scattered!
		for (int i = 0; i < ahead && startIdx + i < endPiece; ++i) {
			lt::piece_index_t p{startIdx + i};
			if (i <= 1) {
				desired[p] = {lt::top_priority, i * 40};
			} else if (i <= 3) {
				desired[p] = {lt::download_priority_t{5}, 100 + i * 60};
			} else {
				desired[p] = {lt::download_priority_t{3}, 250 + i * 80};
			}
		}

		// MP4 moov / MKV Cues are often in the last 1-2 pieces of the file.
		int const tailIdx = static_cast<int>(info->layout().map_file(selectedFile, fileSize - 1, 1).piece);
		int const firstIdx = static_cast<int>(info->layout().map_file(selectedFile, 0, 1).piece);
		if (tailIdx >= firstIdx) {
			desired[lt::piece_index_t{tailIdx}] = {lt::top_priority, 80};
			if (tailIdx - 1 >= firstIdx) {
				desired[lt::piece_index_t{tailIdx - 1}] = {lt::top_priority, 120};
			}
		}

		if (force) {
			std::vector<lt::download_priority_t> priorities(endPiece, lt::dont_download);
			handle.prioritize_pieces(priorities);
		}
		for (auto piece : hotPieces) if (!desired.count(piece)) {
			handle.reset_piece_deadline(piece);
			handle.piece_priority(piece, lt::dont_download);
		}
		std::set<lt::piece_index_t> nextHot;
		for (auto const& [piece, cfg] : desired) {
			nextHot.insert(piece);
			handle.piece_priority(piece, cfg.first);
			handle.set_piece_deadline(piece, cfg.second);
		}
		hotPieces = std::move(nextHot);
		for (auto const& peer : peers) handle.connect_peer(peer);
	}
	void alert_loop() {
		while (!stopped) {
			session->wait_for_alert(std::chrono::milliseconds(250));
			std::vector<lt::alert*> batch;
			session->pop_alerts(&batch);
			for (lt::alert* alert : batch) {
				if (alert->category() & lt::alert_category::error)
					__android_log_print(ANDROID_LOG_ERROR, "FrameZooTorrent", "%s", alert->message().c_str());
				if (auto* metadata = lt::alert_cast<lt::metadata_received_alert>(alert)) {
					std::lock_guard<std::mutex> lock(mutex);
					info = metadata->handle.torrent_file(); metadataReady = bool(info); changed.notify_all();
				}
				if (auto* failed = lt::alert_cast<lt::torrent_error_alert>(alert)) {
					std::lock_guard<std::mutex> lock(mutex);
					error = failed->error.message(); changed.notify_all();
				}
				if (auto* priorities = lt::alert_cast<lt::file_prio_alert>(alert)) {
					std::lock_guard<std::mutex> lock(mutex);
					if (priorities->error) error = priorities->error.message();
					filePrioritiesReady = true; changed.notify_all();
				}
				if (auto* state = lt::alert_cast<lt::state_changed_alert>(alert);
					state && state->state == lt::torrent_status::downloading) {
					std::lock_guard<std::mutex> lock(prioritiesMutex);
					for (auto const& peer : peers) handle.connect_peer(peer);
				}
				if (auto* finished = lt::alert_cast<lt::piece_finished_alert>(alert))
					if (auto storage = disk ? disk->active_storage() : nullptr) {
						if (storage->was_evicted(finished->piece_index)) __android_log_print(ANDROID_LOG_INFO, "FrameZooTorrent", "reloaded piece=%d", static_cast<int>(finished->piece_index));
						storage->verified(finished->piece_index);
					}
				if (lt::alert_cast<lt::torrent_checked_alert>(alert) && recheckPending.exchange(false)) {
					auto status = handle.status();
					__android_log_print(ANDROID_LOG_INFO, "FrameZooTorrent", "checked after eviction state=%d paused=%d peers=%d", int(status.state), int(bool(status.flags & lt::torrent_flags::paused)), status.num_peers);
					handle.resume();
					{
						std::lock_guard<std::mutex> lock(prioritiesMutex);
						if (!peers.empty()) handle.clear_peers();
					}
					prioritize(currentOffset, true);
				}
			}
		}
	}
	std::unique_ptr<lt::session> session;
	lt::torrent_handle handle;
	std::shared_ptr<lt::torrent_info const> info;
	temp_disk_io* disk{nullptr};
	std::thread alerts;
	std::mutex mutex;
	std::condition_variable changed;
	std::atomic<bool> cancelled{false};
	std::atomic<bool> stopped{false};
	std::atomic<bool> recheckPending{false};
	std::atomic<std::int64_t> currentOffset{0};
	std::mutex prioritiesMutex;
	std::set<lt::piece_index_t> hotPieces;
	std::vector<lt::tcp::endpoint> peers;
	lt::piece_index_t currentPiece{-1};
	bool metadataReady{false};
	bool filePrioritiesReady{false};
	std::string error;
	lt::file_index_t selectedFile{-1};
	std::int64_t fileSize{0};
};

TorrentStream::TorrentStream() : impl(std::make_unique<Impl>()) {}
TorrentStream::~TorrentStream() = default;
std::string TorrentStream::start(std::string magnet, int fileIndex) { return impl->start(std::move(magnet), fileIndex); }
std::int64_t TorrentStream::size() const { return impl->size(); }
void TorrentStream::cancel_start() { impl->cancel_start(); }
void TorrentStream::cancel() { impl->cancel(); }
void TorrentStream::seek(std::int64_t offset) { impl->seek(offset); }
std::int64_t TorrentStream::read(std::int64_t offset, char* target, std::uint64_t wanted) { return impl->read(offset, target, wanted); }
void TorrentStream::add_peer(std::string const& host, int port) { impl->add_peer(host, port); }
std::string TorrentStream::stats_json() const { return impl->stats_json(); }
