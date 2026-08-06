// NSCWamr.h
//
// Public header for the NSCWamr framework. The implementation is Swift
// (@objc classes in NSCWamr.swift); this header exists so the NativeScript
// iOS metadata generator (a clang-based parser) can see the class surface —
// the exact class names and selectors below mirror the Swift @objc
// declarations, including the trailing `error:` out-parameter convention
// (JS: `loadModuleError(bytes)` etc.).
#import <Foundation/Foundation.h>

@class NSCWamrModule;
@class NSCWamrFunction;

NS_ASSUME_NONNULL_BEGIN

/// Host import callback: subclasses override `invoke(_:)`.
@interface NSCWamrHostCallback : NSObject
- (NSArray * _Nullable)invoke:(NSArray *)args;
@end

/// A WAMR runtime: owns module instances, exec environments and the
/// registered host callbacks.
@interface NSCWamrRuntime : NSObject
- (instancetype)initWithStackSize:(NSUInteger)stackSizeInBytes
                     wasiEnabled:(BOOL)wasiEnabled
                   executionTier:(NSString *)executionTier;
- (instancetype)init;
+ (NSString *)wamrVersion;
- (NSCWamrModule * _Nullable)loadModule:(NSData *)bytes error:(NSError **)error;
- (NSCWamrModule * _Nullable)loadModuleFromFile:(NSString *)path error:(NSError **)error;
- (NSCWamrFunction * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
@property (nonatomic, readonly) NSUInteger memorySize;
- (NSData * _Nullable)readMemoryAtOffset:(NSUInteger)offset
                                  length:(NSUInteger)length
                                   error:(NSError **)error;
- (BOOL)writeMemoryAtOffset:(NSUInteger)offset
                       data:(NSData *)data
                      error:(NSError **)error;
@end

/// A loaded (and lazily instantiated) WebAssembly module.
@interface NSCWamrModule : NSObject
@property (nonatomic, weak, nullable) NSCWamrRuntime *runtime;
@property (nonatomic, readonly) NSString *name;
- (NSCWamrFunction * _Nullable)findFunction:(NSString *)name error:(NSError **)error;
- (BOOL)linkHostFunction:(NSString *)moduleName
                    name:(NSString *)name
               signature:(NSString *)signature
                callback:(NSCWamrHostCallback *)callback
                   error:(NSError **)error;
- (id _Nullable)getGlobal:(NSString *)name error:(NSError **)error;
- (BOOL)setGlobal:(NSString *)name value:(id)value error:(NSError **)error;
@end

/// A callable function of a loaded module.
@interface NSCWamrFunction : NSObject
@property (nonatomic, readonly) NSCWamrRuntime *runtime;
@property (nonatomic, readonly) NSString *name;
@property (nonatomic, readonly) NSArray<NSString *> *paramTypes;
@property (nonatomic, readonly) NSArray<NSString *> *returnTypes;
- (NSArray * _Nullable)callWithArguments:(NSArray *)arguments error:(NSError **)error;
@end

NS_ASSUME_NONNULL_END
