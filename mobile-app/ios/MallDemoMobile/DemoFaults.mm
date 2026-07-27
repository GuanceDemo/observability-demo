#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <UIKit/UIKit.h>

#ifndef DEMO_FAULTS_ENABLED
#define DEMO_FAULTS_ENABLED 0
#endif

@interface DemoFaults : NSObject <RCTBridgeModule>
@end

@implementation DemoFaults

RCT_EXPORT_MODULE(DemoFaults)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSDictionary *)constantsToExport
{
  NSString *gatewayURL =
      [[NSBundle mainBundle] objectForInfoDictionaryKey:@"MallDemoGatewayURL"] ?: @"";
  return @{
    @"dangerousFaultsEnabled" : @(DEMO_FAULTS_ENABLED == 1),
    @"gatewayUrl" : gatewayURL,
  };
}

RCT_REMAP_METHOD(
    crash,
    crashWithMessage:(NSString *)message
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
#if DEMO_FAULTS_ENABLED
  dispatch_async(dispatch_get_main_queue(), ^{
    @throw [NSException exceptionWithName:@"DemoInjectedNativeCrash"
                                   reason:message
                                 userInfo:@{@"fault_id" : @"mobile_native_crash"}];
  });
#else
  reject(@"DEMO_FAULTS_DISABLED", @"Native crash is disabled in the Safe build", nil);
#endif
}

RCT_REMAP_METHOD(
    blockMainThread,
    blockMainThreadForMilliseconds:(nonnull NSNumber *)durationMs
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
#if DEMO_FAULTS_ENABLED
  NSTimeInterval seconds = MIN(MAX(durationMs.doubleValue / 1000.0, 1.0), 12.0);
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSThread sleepForTimeInterval:seconds];
    resolve(nil);
  });
#else
  reject(
      @"DEMO_FAULTS_DISABLED",
      @"Main-thread blocking is disabled in the Safe build",
      nil);
#endif
}

RCT_REMAP_METHOD(
    openGuanceUrl,
    openGuanceURL:(NSString *)urlString
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [NSURL URLWithString:urlString];
  NSString *scheme = url.scheme.lowercaseString;
  NSString *host = url.host.lowercaseString;
  BOOL isGuanceHost =
      [host hasSuffix:@".guance.com"] || [host hasSuffix:@".guance.one"];
  if (url == nil ||
      (!([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"])) ||
      !isGuanceHost) {
    reject(@"INVALID_GUANCE_URL", @"Only Guance HTTP(S) links are allowed", nil);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    NSDictionary *universalLinkOptions =
        @{UIApplicationOpenURLOptionUniversalLinksOnly : @YES};
    [[UIApplication sharedApplication]
        openURL:url
        options:universalLinkOptions
        completionHandler:^(BOOL openedInApp) {
          if (openedInApp) {
            resolve(@YES);
            return;
          }
          [[UIApplication sharedApplication]
              openURL:url
              options:@{}
              completionHandler:^(BOOL openedInBrowser) {
                if (openedInBrowser) {
                  resolve(@NO);
                } else {
                  reject(
                      @"NO_URL_HANDLER",
                      @"No application can open the Guance link",
                      nil);
                }
              }];
        }];
  });
}

@end
