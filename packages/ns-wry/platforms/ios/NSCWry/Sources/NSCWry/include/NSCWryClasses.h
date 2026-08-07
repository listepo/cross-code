// NSCWryClasses.h
//
// Public header for the NSCWry framework. The implementation is Swift
// (@objc classes in NSCWry.swift); this header mirrors the @objc surface so
// the NativeScript iOS metadata generator can see it.
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// The wry engine runtime entry point.
@interface NSCWryRuntime : NSObject
- (instancetype)initWithStackSize:(NSUInteger)stackSizeInBytes;
- (instancetype)init;
+ (NSString *)wryVersion;
- (void)initRuntime;
- (NSString *)eval:(NSString *)script;
- (void)loadUrl:(NSString *)url;
- (void)setHtml:(NSString *)html;
- (BOOL)isLoaded;
- (id _Nullable)callWithArgs:(NSArray *)args;
- (void)dispose;
@end

NS_ASSUME_NONNULL_END
