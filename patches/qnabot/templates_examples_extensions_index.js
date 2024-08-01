/** *******************************************************************************************************************
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.                                                *
 *                                                                                                                    *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance    *
 *  with the License. A copy of the License is located at                                                             *
 *                                                                                                                    *
 *      http://www.apache.org/licenses/                                                                               *
 *                                                                                                                    *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES *
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
 *  and limitations under the License.                                                                                *
 ******************************************************************************************************************** */

const fs = require('fs');
const _ = require('lodash');
const util = require('../../util');

const js = fs.readdirSync(`${__dirname}/js_lambda_hooks`)
    .map((name) => {
        if (fs.existsSync(`${__dirname}/js_lambda_hooks/${name}/${name}.js`)) {
            return {
                name: `EXT${name}`,
                resource: jslambda(name),
                codeVersionName: `CodeVersion${name}`,
                codeVersionResource: codeVersion(name),
                id: `${name}JS`,
            };
        }
    });

const py = fs.readdirSync(`${__dirname}/py_lambda_hooks`)
    .map((name) => ({
        name: `EXT${name}`,
        resource: pylambda(name),
        codeVersionName: `CodeVersion${name}`,
        codeVersionResource: codeVersion(name),
        id: `${name}PY`,
    }));

const lambda_hooks = js.concat(py);

module.exports = Object.assign(
    _.fromPairs(lambda_hooks.map((x) => [x.name, x.resource])),
    _.fromPairs(lambda_hooks.map((x) => [x.codeVersionName, x.codeVersionResource])),
    {
        EXTUiImport: {
            Type: 'Custom::ExtensionsUiImport',
            Properties: Object.assign(
                _.fromPairs(lambda_hooks.map((x) => [x.id, { Ref: x.name }])),
                {
                    ServiceToken: { 'Fn::GetAtt': ['EXTUiImportLambda', 'Arn'] },
                    photos: { 'Fn::Sub': '${ApiUrlName}/examples/photos' },
                    Bucket: { Ref: 'AssetBucket' },
                    version: { Ref: 'EXTUiImportVersion' },
                },
            ),
        },
        EXTUiImportLambda: {
            Type: 'AWS::Lambda::Function',
            Properties: {
                Code: {
                    S3Bucket: { Ref: 'BootstrapBucket' },
                    S3Key: {
                        'Fn::Join': ['', [
                            { Ref: 'BootstrapPrefix' },
                            '/lambda/EXTUiImports.zip',
                        ]],
                    },
                    S3ObjectVersion: { Ref: 'EXTUiImportVersion' },
                },
                Environment: {
                    Variables: {
                        ...util.getCommonEnvironmentVariables()
                    },
                },
                Handler: 'ui_import.handler',
                MemorySize: '128',
                Role: { Ref: 'CFNLambdaRole' },
                Runtime: process.env.npm_package_config_lambdaRuntime,
                Timeout: 300,
                VpcConfig: {
                    'Fn::If': ['VPCEnabled', {
                        SubnetIds: { 'Fn::Split': [',', { Ref: 'VPCSubnetIdList' }] },
                        SecurityGroupIds: { 'Fn::Split': [',', { Ref: 'VPCSecurityGroupIdList' }] },
                    }, { Ref: 'AWS::NoValue' }],
                },
                TracingConfig: {
                    'Fn::If': ['XRAYEnabled', { Mode: 'Active' },
                        { Ref: 'AWS::NoValue' }],
                },
                Layers: [
                    { Ref: 'AwsSdkLayerLambdaLayer' },
                ],
                Tags: [{
                    Key: 'Type',
                    Value: 'CustomResource',
                }],
            },
            Metadata: util.cfnNag(['W92', 'W58']),
        },
        EXTUiImportVersion: {
            Type: 'Custom::S3Version',
            Properties: {
                ServiceToken: { Ref: 'CFNLambda' },
                Bucket: { Ref: 'BootstrapBucket' },
                Key: { 'Fn::Sub': '${BootstrapPrefix}/lambda/EXTUiImports.zip' },
                BuildDate: (new Date()).toISOString(),
            },
        },
        JsLambdaHookSDKLambdaLayerCodeVersion: {
            Type: 'Custom::S3Version',
            Properties: {
                ServiceToken: { Ref: 'CFNLambda' },
                Bucket: { Ref: 'BootstrapBucket' },
                Key: { 'Fn::Sub': '${BootstrapPrefix}/lambda/js_lambda_hook_sdk.zip' },
                BuildDate: new Date().toISOString(),
            },
        },
        JsLambdaHookSDKLambdaLayer: {
            Type: 'AWS::Lambda::LayerVersion',
            Properties: {
                Content: {
                    S3Bucket: { Ref: 'BootstrapBucket' },
                    S3Key: { 'Fn::Sub': '${BootstrapPrefix}/lambda/js_lambda_hook_sdk.zip' },
                    S3ObjectVersion: { Ref: 'JsLambdaHookSDKLambdaLayerCodeVersion' },
                },
                LayerName: {
                    'Fn::Join': [
                        '-',
                        [
                            'JsLambdaHookSDK',
                            {
                                'Fn::Select': [
                                    2,
                                    { 'Fn::Split': ['-', { Ref: 'DefaultQnABotSettings' }] },
                                ],
                            },
                        ],
                    ],
                },
                CompatibleRuntimes: [process.env.npm_package_config_lambdaRuntime],
            },
        },
        ExtensionsInvokePolicy: {
            Type: 'AWS::IAM::ManagedPolicy',
            Properties: {
                PolicyDocument: {
                    Version: '2012-10-17',
                    Statement: [{
                        Effect: 'Allow',
                        Action: [
                            'lambda:InvokeFunction',
                        ],
                        Resource: lambda_hooks
                            .map((x) => ({ 'Fn::GetAtt': [x.name, 'Arn'] })),
                    }],
                },
                Roles: [{ Ref: 'FulfillmentLambdaRole' }],
            },
        },
        ExtensionLambdaRole: {
            Type: 'AWS::IAM::Role',
            Properties: {
                AssumeRolePolicyDocument: {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                Service: 'lambda.amazonaws.com',
                            },
                            Action: 'sts:AssumeRole',
                        },
                    ],
                },
                Path: '/',
                Policies: [
                    util.basicLambdaExecutionPolicy(),
                    util.lambdaVPCAccessExecutionRole(),
                    util.xrayDaemonWriteAccess(),
                    {
                        PolicyName: 'LambdaFeedbackFirehoseQNALambda',
                        PolicyDocument: {
                            Version: '2012-10-17',
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'lambda:InvokeFunction',
                                    ],
                                    Resource: [
                                        { 'Fn::Join': ['', ['arn:aws:lambda:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':function:qna-*']] },
                                        { 'Fn::Join': ['', ['arn:aws:lambda:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':function:QNA-*']] },
                                        { Ref: 'QIDLambdaArn' },
                                    ],
                                },
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'firehose:PutRecord',
                                        'firehose:PutRecordBatch',
                                    ],
                                    Resource: [
                                        { Ref: 'FeedbackFirehose' },
                                    ],
                                },
                            ],
                        },
                    },
                    {
                        PolicyName: 'LexQNALambda',
                        PolicyDocument: {
                            Version: '2012-10-17',
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'lex:PostText',
                                    ],
                                    Resource: [
                                        { 'Fn::Join': ['', ['arn:aws:lex:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':bot:*', ':qna*']] },
                                        { 'Fn::Join': ['', ['arn:aws:lex:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':bot:*', ':QNA*']] },
                                    ],
                                },
                            ],
                        },
                    },
                    {
                        PolicyName: 'QNASecretsManagerLambda',
                        PolicyDocument: {
                            Version: '2012-10-17',
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'secretsmanager:GetResourcePolicy',
                                        'secretsmanager:GetSecretValue',
                                        'secretsmanager:DescribeSecret',
                                    ],
                                    Resource: [
                                        { 'Fn::Join': ['', ['arn:aws:secretsmanager:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':secret:qna-*']] },
                                        { 'Fn::Join': ['', ['arn:aws:secretsmanager:', { Ref: 'AWS::Region' }, ':', { Ref: 'AWS::AccountId' }, ':secret:QNA-*']] },
                                    ],
                                },
                            ],
                        },
                    }],
            },
            Metadata: util.cfnNag(['W11', 'W12']),
        },
    },
);
function jslambda(name) {
    return {
        Type: 'AWS::Lambda::Function',
        Properties: {
            Code: {
                S3Bucket: { Ref: 'BootstrapBucket' },
                S3Key: {
                    'Fn::Join': ['', [
                        { Ref: 'BootstrapPrefix' },
                        `/lambda/EXT${name}.zip`,
                    ]],
                },
                S3ObjectVersion: { Ref: `CodeVersion${name}` },
            },
            Environment: {
                Variables: {
                    ES_INDEX: { Ref: 'Index' },
                    FIREHOSE_NAME: { Ref: 'FeedbackFirehoseName' },
                    ES_ADDRESS: { Ref: 'ESAddress' },
                },
            },
            Handler: `${name}.handler`,
            MemorySize: '2048',
            Role: { 'Fn::GetAtt': ['ExtensionLambdaRole', 'Arn'] },
            Runtime: process.env.npm_package_config_lambdaRuntime,
            Timeout: 300,
            VpcConfig: {
                'Fn::If': ['VPCEnabled', {
                    SubnetIds: { 'Fn::Split': [',', { Ref: 'VPCSubnetIdList' }] },
                    SecurityGroupIds: { 'Fn::Split': [',', { Ref: 'VPCSecurityGroupIdList' }] },
                }, { Ref: 'AWS::NoValue' }],
            },
            Layers: [
                { Ref: 'AwsSdkLayerLambdaLayer' },
                { Ref: 'JsLambdaHookSDKLambdaLayer' },
            ],
            TracingConfig: {
                'Fn::If': ['XRAYEnabled', { Mode: 'Active' },
                    { Ref: 'AWS::NoValue' }],
            },
            Tags: [{
                Key: 'Type',
                Value: 'LambdaHook',
            }],
        },
        Metadata: util.cfnNag(['W92']),
    };
}
function pylambda(name) {
    return {
        Type: 'AWS::Lambda::Function',
        Properties: {
            Code: {
                S3Bucket: { Ref: 'BootstrapBucket' },
                S3Key: {
                    'Fn::Join': ['', [
                        { Ref: 'BootstrapPrefix' },
                        `/lambda/EXT${name}.zip`,
                    ]],
                },
                S3ObjectVersion: { Ref: `CodeVersion${name}` },
            },
            Environment: {
                Variables: {
                    ES_INDEX: { Ref: 'Index' },
                    FIREHOSE_NAME: { Ref: 'FeedbackFirehoseName' },
                    ES_ADDRESS: { Ref: 'ESAddress' },
                    PYTHONPATH: '/var/task/py_modules:/var/runtime:/opt/python',
                    ...util.getCommonEnvironmentVariables()
                },
            },
            Handler: `${name}.handler`,
            MemorySize: '2048',
            Role: { 'Fn::GetAtt': ['ExtensionLambdaRole', 'Arn'] },
            Runtime: process.env.npm_package_config_pythonRuntime,
            Timeout: 300,
            VpcConfig: {
                'Fn::If': ['VPCEnabled', {
                    SubnetIds: { 'Fn::Split': [',', { Ref: 'VPCSubnetIdList' }] },
                    SecurityGroupIds: { 'Fn::Split': [',', { Ref: 'VPCSecurityGroupIdList' }] },
                }, { Ref: 'AWS::NoValue' }],
            },
            TracingConfig: {
                'Fn::If': ['XRAYEnabled', { Mode: 'Active' },
                    { Ref: 'AWS::NoValue' }],
            },
            Tags: [{
                Key: 'Type',
                Value: 'LambdaHook',
            }],
        },
        Metadata: util.cfnNag(['W92']),
    };
}

function codeVersion(name) {
    return {
        Type: 'Custom::S3Version',
        Properties: {
            ServiceToken: { Ref: 'CFNLambda' },
            Bucket: { Ref: 'BootstrapBucket' },
            Key: { 'Fn::Sub': `\${BootstrapPrefix}/lambda/EXT${name}.zip` },
            BuildDate: (new Date()).toISOString(),
        },
    };
}
