// NSCWasm3.h
//
// Public header for the NSCWasm3 framework. The implementation is Swift
// (@objc classes in NSCWasm3.swift); this header exists so the NativeScript
// iOS metadata generator (a clang-based parser) can see the class surface —
// the exact class names and selectors below mirror the Swift @objc
// declarations, including the trailing `error:` out-parameter convention
// (JS: `loadModuleError(bytes)` etc.).
#import <Foundation/Foundation.h>

@class NSCWasm3Module;
@class NSCWasm3Function;

NS_ASSUME_NONNULL_BEGIN

/// Host import callback: subclasses override `invoke(_:)`.
@interface NSCWasm3HostCallback : NSObject
- (NSArray * _Nullable)invoke:(NSArray *)args;
@end

/// A wasm3 runtime: owns module instances, exec environments and the
/// registered host callbacks.
@interface NSCWasm3Runtime : NSObject
- (instancetype)initWithStackSize:(NSUInteger)stackSizeInBytes;
- (instancetype)init;
+ (NSString *)wasm3Version;
- (NSCWasm3Module * _Nullable)loadModule:(NSData *)bytes error:(NSError **)error;
- (NSCWasm3Module * _Nullable)loadModuleFromFile:(NSString *)path error:(NSError **)error;
- (NSCWasm3Function * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
@property (nonatomic, readonly) NSUInteger memorySize;
- (NSData * _Nullable)readMemoryAtOffset:(NSUInteger)offset
                                  length:(NSUInteger)length
                                   error:(NSError **)error;
- (BOOL)writeMemoryAtOffset:(NSUInteger)offset
                       data:(NSData *)data
                      error:(NSError **)error;
@end

/// A loaded (and lazily instantiated) WebAssembly module.
@interface NSCWasm3Module : NSObject
@property (nonatomic, weak, nullable) NSCWasm3Runtime *runtime;
@property (nonatomic, readonly) NSString *name;
- (NSCWasm3Function * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
- (BOOL)linkHostFunction:(NSString *)moduleName
                    name:(NSString *)name
               signature:(NSString *)signature
                callback:(NSCWasm3HostCallback *)callback
                   error:(NSError **)error;
- (id _Nullable)getGlobal:(NSString *)name error:(NSError **)error;
- (BOOL)setGlobal:(NSString *)name value:(id)value error:(NSError **)error;
@end

/// A callable function of a loaded module.
@interface NSCWasm3Function : NSObject
@property (nonatomic, readonly) NSCWasm3Runtime *runtime;
@property (nonatomic, readonly) NSString *name;
@property (nonatomic, readonly) NSArray<NSString *> *paramTypes;
@property (nonatomic, readonly) NSArray<NSString *> *returnTypes;
- (NSArray * _Nullable)callWithArguments:(NSArray *)arguments error:(NSError **)error;
@end

NS_ASSUME_NONNULL_END
