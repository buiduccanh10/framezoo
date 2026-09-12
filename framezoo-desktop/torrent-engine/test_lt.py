import libtorrent as lt
s = lt.torrent_status()
print(s.state.name if hasattr(s.state, "name") else str(s.state))
