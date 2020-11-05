/**
 * External dependencies
 */
import TestRenderer, { act } from 'react-test-renderer';

/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { createRegistry } from '../../../registry';
import { RegistryProvider } from '../../registry-provider';
import useSelect from '../index';

describe( 'useSelect', () => {
	let registry;
	beforeEach( () => {
		registry = createRegistry();
	} );

	const getTestComponent = ( mapSelectSpy, dependencyKey ) => ( props ) => {
		const dependencies = props[ dependencyKey ];
		mapSelectSpy.mockImplementation( ( select ) => ( {
			results: select( 'testStore' ).testSelector( props.keyName ),
		} ) );
		const data = useSelect( mapSelectSpy, [ dependencies ] );
		return <div>{ data.results }</div>;
	};

	it( 'passes the relevant data to the component', () => {
		registry.registerStore( 'testStore', {
			reducer: () => ( { foo: 'bar' } ),
			selectors: {
				testSelector: ( state, key ) => state[ key ],
			},
		} );
		const selectSpy = jest.fn();
		const TestComponent = jest
			.fn()
			.mockImplementation( getTestComponent( selectSpy, 'keyName' ) );
		let renderer;
		act( () => {
			renderer = TestRenderer.create(
				<RegistryProvider value={ registry }>
					<TestComponent keyName="foo" />
				</RegistryProvider>
			);
		} );
		const testInstance = renderer.root;
		// 2 times expected
		// - 1 for initial mount
		// - 1 for after mount before subscription set.
		expect( selectSpy ).toHaveBeenCalledTimes( 2 );
		expect( TestComponent ).toHaveBeenCalledTimes( 1 );

		// ensure expected state was rendered
		expect( testInstance.findByType( 'div' ).props ).toEqual( {
			children: 'bar',
		} );
	} );

	it( 'uses memoized selector if dependencies do not change', () => {
		registry.registerStore( 'testStore', {
			reducer: () => ( { foo: 'bar' } ),
			selectors: {
				testSelector: ( state, key ) => state[ key ],
			},
		} );

		const selectSpyFoo = jest.fn().mockImplementation( () => 'foo' );
		const selectSpyBar = jest.fn().mockImplementation( () => 'bar' );
		const TestComponent = jest.fn().mockImplementation( ( props ) => {
			const mapSelect = props.change ? selectSpyFoo : selectSpyBar;
			const data = useSelect( mapSelect, [ props.keyName ] );
			return <div>{ data }</div>;
		} );
		let renderer;
		act( () => {
			renderer = TestRenderer.create(
				<RegistryProvider value={ registry }>
					<TestComponent keyName="foo" change={ true } />
				</RegistryProvider>
			);
		} );
		const testInstance = renderer.root;

		expect( selectSpyFoo ).toHaveBeenCalledTimes( 2 );
		expect( selectSpyBar ).toHaveBeenCalledTimes( 0 );
		expect( TestComponent ).toHaveBeenCalledTimes( 1 );

		// ensure expected state was rendered
		expect( testInstance.findByType( 'div' ).props ).toEqual( {
			children: 'foo',
		} );

		//rerender with non dependency changed
		act( () => {
			renderer.update(
				<RegistryProvider value={ registry }>
					<TestComponent keyName="foo" change={ false } />
				</RegistryProvider>
			);
		} );

		expect( selectSpyFoo ).toHaveBeenCalledTimes( 2 );
		expect( selectSpyBar ).toHaveBeenCalledTimes( 0 );
		expect( TestComponent ).toHaveBeenCalledTimes( 2 );

		// ensure expected state was rendered
		expect( testInstance.findByType( 'div' ).props ).toEqual( {
			children: 'foo',
		} );

		// rerender with dependency changed
		// rerender with non dependency changed
		act( () => {
			renderer.update(
				<RegistryProvider value={ registry }>
					<TestComponent keyName="bar" change={ false } />
				</RegistryProvider>
			);
		} );

		expect( selectSpyFoo ).toHaveBeenCalledTimes( 2 );
		expect( selectSpyBar ).toHaveBeenCalledTimes( 1 );
		expect( TestComponent ).toHaveBeenCalledTimes( 3 );

		// ensure expected state was rendered
		expect( testInstance.findByType( 'div' ).props ).toEqual( {
			children: 'bar',
		} );
	} );
	describe( 'rerenders as expected with various mapSelect return types', () => {
		const getComponent = ( mapSelectSpy ) => () => {
			const data = useSelect( mapSelectSpy, [] );
			return <div data={ data } />;
		};
		let TestComponent;
		const mapSelectSpy = jest.fn( ( select ) =>
			select( 'testStore' ).testSelector()
		);
		const selectorSpy = jest.fn();

		beforeEach( () => {
			registry.registerStore( 'testStore', {
				actions: {
					forceUpdate: () => ( { type: 'FORCE_UPDATE' } ),
				},
				reducer: ( state = {} ) => ( { ...state } ),
				selectors: {
					testSelector: selectorSpy,
				},
			} );
			TestComponent = getComponent( mapSelectSpy );
		} );
		afterEach( () => {
			selectorSpy.mockClear();
			mapSelectSpy.mockClear();
		} );

		it.each( [
			[ 'boolean', [ false, true ] ],
			[ 'number', [ 10, 20 ] ],
			[ 'string', [ 'bar', 'cheese' ] ],
			[
				'array',
				[
					[ 10, 20 ],
					[ 10, 30 ],
				],
			],
			[ 'object', [ { foo: 'bar' }, { foo: 'cheese' } ] ],
			[ 'null', [ null, undefined ] ],
			[ 'undefined', [ undefined, 42 ] ],
		] )(
			'renders as expected with %s return values',
			( type, testValues ) => {
				const [ valueA, valueB ] = testValues;
				selectorSpy.mockReturnValue( valueA );
				let renderer;
				act( () => {
					renderer = TestRenderer.create(
						<RegistryProvider value={ registry }>
							<TestComponent />
						</RegistryProvider>
					);
				} );
				const testInstance = renderer.root;
				// ensure expected state was rendered.
				expect( testInstance.findByType( 'div' ).props.data ).toEqual(
					valueA
				);

				// Update the returned value from the selector and trigger the
				// subscription which should in turn trigger a re-render.
				act( () => {
					selectorSpy.mockReturnValue( valueB );
					registry.dispatch( 'testStore' ).forceUpdate();
				} );
				expect( testInstance.findByType( 'div' ).props.data ).toEqual(
					valueB
				);
				expect( mapSelectSpy ).toHaveBeenCalledTimes( 3 );
			}
		);
	} );

	describe( 're-calls the selector as minimal times as possible', () => {
		const counterStore = {
			actions: {
				increment: () => ( { type: 'INCREMENT' } ),
			},
			reducer: ( state, action ) => {
				if ( ! state ) {
					return { counter: 0 };
				}
				if ( action?.type === 'INCREMENT' ) {
					return { counter: state.counter + 1 };
				}
				return state;
			},
			selectors: {
				getCounter: ( state ) => state.counter,
			},
		};

		it( 'only calls the selectors it has selected', () => {
			registry.registerStore( 'store-1', counterStore );
			registry.registerStore( 'store-2', counterStore );

			let renderer;

			const selectCount1 = jest.fn();
			const selectCount2 = jest.fn();

			const TestComponent = jest.fn( () => {
				const count1 = useSelect(
					( select ) =>
						selectCount1() || select( 'store-1' ).getCounter(),
					[]
				);
				useSelect(
					( select ) =>
						selectCount2() || select( 'store-2' ).getCounter(),
					[]
				);

				return <div data={ count1 } />;
			} );

			act( () => {
				renderer = TestRenderer.create(
					<RegistryProvider value={ registry }>
						<TestComponent />
					</RegistryProvider>
				);
			} );

			const testInstance = renderer.root;

			expect( selectCount1 ).toHaveBeenCalledTimes( 2 );
			expect( selectCount2 ).toHaveBeenCalledTimes( 2 );
			expect( TestComponent ).toHaveBeenCalledTimes( 1 );
			expect( testInstance.findByType( 'div' ).props.data ).toBe( 0 );

			act( () => {
				registry.dispatch( 'store-2' ).increment();
			} );

			expect( selectCount1 ).toHaveBeenCalledTimes( 2 );
			expect( selectCount2 ).toHaveBeenCalledTimes( 3 );
			expect( TestComponent ).toHaveBeenCalledTimes( 2 );
			expect( testInstance.findByType( 'div' ).props.data ).toBe( 0 );

			act( () => {
				registry.dispatch( 'store-1' ).increment();
			} );

			expect( selectCount1 ).toHaveBeenCalledTimes( 3 );
			expect( selectCount2 ).toHaveBeenCalledTimes( 3 );
			expect( TestComponent ).toHaveBeenCalledTimes( 3 );
			expect( testInstance.findByType( 'div' ).props.data ).toBe( 1 );
		} );

		it( 'can subscribe to multiple stores at once', () => {
			registry.registerStore( 'store-1', counterStore );
			registry.registerStore( 'store-2', counterStore );
			registry.registerStore( 'store-3', counterStore );

			let renderer;

			const selectCount1And2 = jest.fn();

			const TestComponent = jest.fn( () => {
				const { count1, count2 } = useSelect(
					( select ) =>
						selectCount1And2() || {
							count1: select( 'store-1' ).getCounter(),
							count2: select( 'store-2' ).getCounter(),
						},
					[]
				);

				return <div data={ { count1, count2 } } />;
			} );

			act( () => {
				renderer = TestRenderer.create(
					<RegistryProvider value={ registry }>
						<TestComponent />
					</RegistryProvider>
				);
			} );

			const testInstance = renderer.root;

			expect( selectCount1And2 ).toHaveBeenCalledTimes( 2 );
			expect( testInstance.findByType( 'div' ).props.data ).toEqual( {
				count1: 0,
				count2: 0,
			} );

			act( () => {
				registry.dispatch( 'store-2' ).increment();
			} );

			expect( selectCount1And2 ).toHaveBeenCalledTimes( 3 );
			expect( testInstance.findByType( 'div' ).props.data ).toEqual( {
				count1: 0,
				count2: 1,
			} );

			act( () => {
				registry.dispatch( 'store-3' ).increment();
			} );

			expect( selectCount1And2 ).toHaveBeenCalledTimes( 3 );
			expect( testInstance.findByType( 'div' ).props.data ).toEqual( {
				count1: 0,
				count2: 1,
			} );
		} );

		it( 're-calls the selector when deps changed', () => {
			registry.registerStore( 'store-1', counterStore );
			registry.registerStore( 'store-2', counterStore );
			registry.registerStore( 'store-3', counterStore );

			let renderer, dep, setDep;
			const selectCount1AndDep = jest.fn();

			const TestComponent = jest.fn( () => {
				[ dep, setDep ] = useState( 0 );
				const state = useSelect(
					( select ) =>
						selectCount1AndDep() || {
							count1: select( 'store-1' ).getCounter(),
							dep,
						},
					[ dep ]
				);

				return <div data={ state } />;
			} );

			act( () => {
				renderer = TestRenderer.create(
					<RegistryProvider value={ registry }>
						<TestComponent />
					</RegistryProvider>
				);
			} );

			const testInstance = renderer.root;

			expect( selectCount1AndDep ).toHaveBeenCalledTimes( 2 );
			expect( testInstance.findByType( 'div' ).props.data ).toEqual( {
				count1: 0,
				dep: 0,
			} );

			act( () => {
				setDep( 1 );
			} );

			expect( selectCount1AndDep ).toHaveBeenCalledTimes( 3 );
			expect( testInstance.findByType( 'div' ).props.data ).toEqual( {
				count1: 0,
				dep: 1,
			} );
		} );
	} );
} );
