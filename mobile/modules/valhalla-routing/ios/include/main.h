#ifndef WRAPPER_H
#define WRAPPER_H

#include "valhalla_actor.h"

#ifdef __APPLE__

std::string route(const char *request, void* actor);
void* create_valhalla_actor(const char *config_path, ValhallaMobileHttpClient* http_client = nullptr);
void delete_valhalla_actor(void* actor);

#endif

#endif
