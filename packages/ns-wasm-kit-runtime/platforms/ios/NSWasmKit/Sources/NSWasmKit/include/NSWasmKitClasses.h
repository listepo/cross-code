// Public header for the NSWasmKit framework. The implementation is Swift
// (@objc classes in NSWasmKit.swift); this header exists so the NativeScript
// iOS metadata generator (a clang-based parser) can see the class surface --
// the exact class names and selectors below mirror the Swift @objc
// declarations, including the trailing `error:` out-parameter convention
// (JS: `loadModuleBytesError(bytes)` etc.).
#import <Foundation/Foundation.h>

@class NSWasmKitModule;
@class NSWasmKitFunction;

NS_ASSUME_NONNULL_BEGIN

@interface NSWasmKitHostCallback : NSObject
- (NSArray * _Nullable)invoke:(NSArray *)args;
@end

@interface NSWasmKitRuntime : NSObject
- (instancetype)initWithStackSize:(NSUInteger)stackSizeInBytes;
- (instancetype)init;
+ (NSString *)wasmkitVersion;
- (NSWasmKitModule * _Nullable)loadModuleFromBytes:(NSData *)bytes error:(NSError **)error;
- (NSWasmKitModule * _Nullable)loadModuleFromFile:(NSString *)path error:(NSError **)error;
- (NSWasmKitFunction * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
@property (nonatomic, readonly) NSUInteger memorySize;
- (NSData * _Nullable)readMemoryAtOffset:(NSUInteger)offset
                                  length:(NSUInteger)length
                                   error:(NSError **)error;
- (BOOL)writeMemoryAtOffset:(NSUInteger)offset
                       data:(NSData *)data
                      error:(NSError **)error;
@end

@interface NSWasmKitModule : NSObject
@property (nonatomic, readonly) NSString *name;
- (NSWasmKitFunction * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
- (BOOL)linkHostFunction:(NSString *)moduleName
                    name:(NSString *)name
               signature:(NSString *)signature
                callback:(NSWasmKitHostCallback *)callback
                   error:(NSError **)error;
- (id _Nullable)getGlobal:(NSString *)name error:(NSError **)error;
- (BOOL)setGlobal:(NSString *)name value:(id)value error:(NSError **)error;
@end

@interface NSWasmKitFunction : NSObject
@property (nonatomic, readonly) NSString *name;
@property (nonatomic, readonly) NSArray<NSString *> *paramTypes;
@property (nonatomic, readonly) NSArray<NSString *> *returnTypes;
- (NSArray * _Nullable)callWithArguments:(NSArray *)arguments error:(NSError **)error;
@end

NS_ASSUME_NONNULL_END
