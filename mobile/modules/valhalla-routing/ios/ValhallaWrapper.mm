#import "ValhallaWrapper.h"

#import <Foundation/Foundation.h>
#import <include/main.h>

static NSString* EscapeJsonString(NSString* value) {
  NSMutableString* escaped = [value mutableCopy];
  [escaped replaceOccurrencesOfString:@"\\" withString:@"\\\\" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\"" withString:@"\\\"" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\n" withString:@"\\n" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\r" withString:@"\\r" options:0 range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\t" withString:@"\\t" options:0 range:NSMakeRange(0, escaped.length)];
  return escaped;
}

static NSString* AppendRequestDebug(NSString* response, NSString* request) {
  if (![response hasPrefix:@"{\"code\":"] && ![response hasPrefix:@"{\"error\":"]) {
    return response;
  }

  NSString* prefix = request.length > 120 ? [request substringToIndex:120] : request;
  NSString* marker = [NSString stringWithFormat:@" req_prefix=%@", prefix];

  NSData* data = [response dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
  if ([parsed isKindOfClass:[NSMutableDictionary class]]) {
    NSMutableDictionary* json = (NSMutableDictionary*)parsed;
    NSString* key = json[@"message"] ? @"message" : @"error";
    NSString* message = [json[key] isKindOfClass:[NSString class]] ? json[key] : @"Valhalla route error";
    json[key] = [message stringByAppendingString:marker];
    NSData* out = [NSJSONSerialization dataWithJSONObject:json options:0 error:nil];
    if (out) {
      return [[NSString alloc] initWithData:out encoding:NSUTF8StringEncoding] ?: response;
    }
  }

  return response;
}

class ValhallaMobileHttpClientImpl : public ValhallaMobileHttpClient {
public:
  valhalla::baldr::tile_getter_t::GET_response_t
  get(const std::string& url, uint64_t range_offset = 0, uint64_t range_size = 0) override {
    valhalla::baldr::tile_getter_t::GET_response_t response;

    @autoreleasepool {
      NSString* urlString = [NSString stringWithUTF8String:url.c_str()];
      NSURL* nsurl = [NSURL URLWithString:urlString];
      if (!nsurl) {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
        response.http_code_ = 0;
        return response;
      }

      NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:nsurl];
      request.HTTPMethod = @"GET";
      request.timeoutInterval = 10;
      if (range_size > 0) {
        NSString* rangeHeader = [NSString stringWithFormat:@"bytes=%llu-%llu",
                                 range_offset, range_offset + range_size - 1];
        [request setValue:rangeHeader forHTTPHeaderField:@"Range"];
      }

      NSHTTPURLResponse* httpResponse = nil;
      NSError* error = nil;
      NSData* data = [NSURLConnection sendSynchronousRequest:request
                                           returningResponse:&httpResponse
                                                       error:&error];

      if (error || !httpResponse) {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
        response.http_code_ = httpResponse ? httpResponse.statusCode : 0;
        return response;
      }

      response.http_code_ = httpResponse.statusCode;
      if (httpResponse.statusCode >= 200 && httpResponse.statusCode < 300) {
        if (data) {
          const char* dataBytes = static_cast<const char*>(data.bytes);
          response.bytes_.assign(dataBytes, dataBytes + data.length);
        }
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::SUCCESS;
      } else {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
      }
    }

    return response;
  }

  valhalla::baldr::tile_getter_t::HEAD_response_t
  head(const std::string& url, valhalla::baldr::tile_getter_t::header_mask_t header_mask) override {
    valhalla::baldr::tile_getter_t::HEAD_response_t response;

    @autoreleasepool {
      NSString* urlString = [NSString stringWithUTF8String:url.c_str()];
      NSURL* nsurl = [NSURL URLWithString:urlString];
      if (!nsurl) {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
        response.http_code_ = 0;
        return response;
      }

      NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:nsurl];
      request.HTTPMethod = @"HEAD";
      request.timeoutInterval = 10;

      NSHTTPURLResponse* httpResponse = nil;
      NSError* error = nil;
      [NSURLConnection sendSynchronousRequest:request
                            returningResponse:&httpResponse
                                        error:&error];

      if (error || !httpResponse) {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
        response.http_code_ = httpResponse ? httpResponse.statusCode : 0;
        return response;
      }

      response.http_code_ = httpResponse.statusCode;
      if (httpResponse.statusCode >= 200 && httpResponse.statusCode < 300) {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::SUCCESS;
        if (header_mask & valhalla::baldr::tile_getter_t::kHeaderLastModified) {
          NSString* lastModified = [httpResponse valueForHTTPHeaderField:@"Last-Modified"];
          if (lastModified) {
            NSDateFormatter* formatter = [[NSDateFormatter alloc] init];
            formatter.dateFormat = @"EEE, dd MMM yyyy HH:mm:ss zzz";
            formatter.locale = [[NSLocale alloc] initWithLocaleIdentifier:@"en_US_POSIX"];
            NSDate* date = [formatter dateFromString:lastModified];
            response.last_modified_time_ = (uint64_t)[date timeIntervalSince1970];
          } else {
            response.last_modified_time_ = 0;
          }
        }
      } else {
        response.status_ = valhalla::baldr::tile_getter_t::status_code_t::FAILURE;
      }
    }

    return response;
  }
};

@implementation ValhallaWrapper

- (instancetype)initWithConfigPath:(NSString*)configPath error:(__autoreleasing NSError **)error
{
  self = [super init];
  std::string path = std::string([configPath UTF8String]);
  try {
    ValhallaMobileHttpClient* httpClient = new ValhallaMobileHttpClientImpl();
    _actor = create_valhalla_actor(path.c_str(), httpClient);
  } catch (NSException *exception) {
    if (error) {
      *error = [[NSError alloc] initWithDomain:exception.name code:0 userInfo:@{
        NSUnderlyingErrorKey: exception,
        NSLocalizedDescriptionKey: exception.reason ?: @"Valhalla exception",
        @"CallStackSymbols": exception.callStackSymbols
      }];
    }
    return nil;
  } catch (const std::exception &err) {
    if (error) {
      *error = [[NSError alloc] initWithDomain:@"ValhallaWrapper" code:-1 userInfo:@{
        NSLocalizedDescriptionKey: [NSString stringWithUTF8String:err.what()]
      }];
    }
    return nil;
  } catch (...) {
    if (error) {
      *error = [[NSError alloc] initWithDomain:@"ValhallaWrapper" code:-1 userInfo:@{
        NSLocalizedDescriptionKey: @"Unknown Valhalla exception"
      }];
    }
    return nil;
  }
  return self;
}

- (NSString*)route:(NSString*)request
{
  @synchronized(self) {
    try {
      std::string req = std::string([request UTF8String]);
      std::string res = ::route(req.c_str(), _actor);
      NSString* response = [NSString stringWithUTF8String:res.c_str()] ?: @"";
      return AppendRequestDebug(response, request);
    } catch (NSException *exception) {
      NSString* message = exception.reason ?: @"Valhalla route exception";
      return [NSString stringWithFormat:@"{\"error\":\"%@\"}", EscapeJsonString(message)];
    } catch (const std::exception &err) {
      NSString* message = [NSString stringWithUTF8String:err.what()] ?: @"Valhalla route exception";
      return [NSString stringWithFormat:@"{\"error\":\"%@\"}", EscapeJsonString(message)];
    } catch (...) {
      return @"{\"error\":\"Unknown Valhalla route exception\"}";
    }
  }
}

- (void)dealloc
{
  delete_valhalla_actor(_actor);
  _actor = nil;
}

@end
