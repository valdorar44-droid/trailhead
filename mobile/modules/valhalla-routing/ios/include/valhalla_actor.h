#ifndef VALHALLAACTOR_H
#define VALHALLAACTOR_H

#include <memory>
#include <string>
#include <valhalla/baldr/tilegetter.h>
#include <valhalla/tyr/actor.h>

class ValhallaMobileHttpClient {
public:
  virtual ~ValhallaMobileHttpClient() = default;

  virtual valhalla::baldr::tile_getter_t::GET_response_t
  get(const std::string& url, uint64_t range_offset = 0, uint64_t range_size = 0) = 0;

  virtual valhalla::baldr::tile_getter_t::HEAD_response_t
  head(const std::string& url, valhalla::baldr::tile_getter_t::header_mask_t header_mask) = 0;
};

class ValhallaActor {
private:
  std::unique_ptr<valhalla::tyr::actor_t> actor;
  std::unique_ptr<valhalla::baldr::GraphReader> graph_reader;

public:
  ValhallaActor(const std::string& config_path, ValhallaMobileHttpClient* http_client = nullptr);

  std::string route(const std::string& request);
};

#endif
