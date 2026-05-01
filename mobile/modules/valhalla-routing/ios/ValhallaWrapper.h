#ifndef ValhallaWrapperHeader_h
#define ValhallaWrapperHeader_h

#import <Foundation/Foundation.h>

@class ValhallaWrapper;

@interface ValhallaWrapper : NSObject {
@private
  void* _actor;
}

- (instancetype)initWithConfigPath:(NSString*)configPath error:(__autoreleasing NSError **)error;
- (NSString*)route:(NSString*)request;

@end

#endif
